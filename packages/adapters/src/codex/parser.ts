import { randomUUID } from "node:crypto";
import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import { CODEX_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import { isObject, numericValue, parseLines, stringValue, timestampToIso } from "./source.ts";

const AGENT_NAME = "codex-cli";

function buildHeader(first: Record<string, unknown>): Header {
  if (first.type !== "session_meta") {
    throw new Error(
      `Codex session must start with type:"session_meta"; got ${JSON.stringify(first.type)}`,
    );
  }
  const payload = isObject(first.payload) ? first.payload : {};
  const id = stringValue(payload.id);
  const ts = timestampToIso(payload.timestamp) ?? timestampToIso(first.timestamp);
  if (id === undefined) throw new Error("Codex session_meta missing payload.id");
  if (ts === undefined) throw new Error("Codex session_meta missing timestamp");
  const cliVersion = stringValue(payload.cli_version);
  const cwd = stringValue(payload.cwd);
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id,
    session_uid: deriveSessionUid(CODEX_SESSION_UID_NAMESPACE, id),
    ts,
    agent: {
      name: AGENT_NAME,
      ...(cliVersion !== undefined ? { version: cliVersion } : {}),
    },
  };
  if (cwd !== undefined) header.cwd = cwd;
  header.source = {
    agent: AGENT_NAME,
    ...(cliVersion !== undefined ? { format_version: cliVersion } : {}),
  };
  return header;
}

type Classified = {
  topType: string;
  payloadType: string | undefined;
  payload: Record<string, unknown>;
  ts: string | undefined;
};

function classify(record: Record<string, unknown>): Classified | undefined {
  const topType = stringValue(record.type);
  if (topType === undefined) return undefined;
  const payload = isObject(record.payload) ? record.payload : {};
  const payloadType = stringValue(payload.type);
  const ts = timestampToIso(record.timestamp);
  return { topType, payloadType, payload, ts };
}

// `event_msg.user_message` / `event_msg.agent_message` are the canonical user
// and agent surfaces in real sessions (verified against codex-tui 0.128 and
// Codex Desktop 0.133-alpha). Text lives in `payload.message`. The parallel
// `response_item.message` channel carries the same content one record later
// but also includes synthetic `role:"developer"` AGENTS.md preambles that
// shouldn't appear as user input — PR1 deliberately picks event_msg and
// leaves cross-channel dedupe to PR2.
function buildUserOrAgentMessageEntry(rec: Classified, ts: string): Entry | undefined {
  const text = stringValue(rec.payload.message) ?? stringValue(rec.payload.text);
  if (text === undefined || text.length === 0) return undefined;
  if (rec.payloadType === "user_message") {
    return {
      type: "user_message",
      id: randomUUID(),
      ts,
      payload: { text },
      source: { agent: AGENT_NAME, original_type: "event_msg.user_message" },
      meta: { "dev.codex.raw_type": "event_msg.user_message" },
    };
  }
  if (rec.payloadType === "agent_message") {
    return {
      type: "agent_message",
      id: randomUUID(),
      ts,
      payload: { text },
      source: { agent: AGENT_NAME, original_type: "event_msg.agent_message" },
      meta: { "dev.codex.raw_type": "event_msg.agent_message" },
    };
  }
  return undefined;
}

type ToolMapping = {
  tool: "shell_command" | "file_read" | "file_edit" | "other";
  args: Record<string, unknown>;
};

// Canonical tool-kind dispatch for PR1. `shell` and `container.exec` map to
// `shell_command`; `read` maps to `file_read`. Everything else, including
// `apply_patch` (patch-path inference is PR2 hardening) and `custom_tool_call`
// (vendor canonicalisation is PR2), is routed to `other` to stay schema-valid
// without claiming canonical kinds we don't yet parse end-to-end.
function mapTool(rawName: string | undefined, rawArgs: unknown): ToolMapping {
  const args = isObject(rawArgs) ? rawArgs : {};
  if (rawName === "shell" || rawName === "container.exec") {
    const cmdString = stringValue(args.cmd) ?? stringValue(args.command);
    if (cmdString !== undefined) {
      return { tool: "shell_command", args: { command: cmdString } };
    }
    // Argv-form parsing deferred to PR2 hardening.
    return { tool: "other", args: { name: rawName, args } };
  }
  if (rawName === "read") {
    const path = stringValue(args.path);
    if (path !== undefined) return { tool: "file_read", args: { path } };
  }
  return { tool: "other", args: { name: rawName ?? "unknown", args } };
}

function parseFunctionArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (isObject(raw)) return raw;
  return {};
}

function buildToolCallEntry(
  rec: Classified,
  ts: string,
): {
  entry: Entry;
  callId: string | undefined;
} {
  const name = stringValue(rec.payload.name);
  const callId = stringValue(rec.payload.call_id);
  const args = parseFunctionArguments(rec.payload.arguments);
  const mapping = mapTool(name, args);
  const id = randomUUID();
  const entry: Entry = {
    type: "tool_call",
    id,
    ts,
    payload: { tool: mapping.tool, args: mapping.args },
    source: { agent: AGENT_NAME, original_type: "response_item.function_call" },
    meta: { "dev.codex.raw_type": "response_item.function_call" },
  };
  if (callId !== undefined) {
    entry.semantic = { call_id: callId, tool_kind: mapping.tool };
  } else {
    entry.semantic = { tool_kind: mapping.tool };
  }
  return { entry, callId };
}

function buildToolResultEntry(
  rec: Classified,
  ts: string,
  callIdToEntryId: Map<string, string>,
): Entry {
  const callId = stringValue(rec.payload.call_id);
  const rawOutput = rec.payload.output;
  const output =
    typeof rawOutput === "string"
      ? rawOutput
      : rawOutput === undefined
        ? ""
        : JSON.stringify(rawOutput);
  const ok = !isObject(rec.payload) || rec.payload.success !== false;
  const payload: Record<string, unknown> = { ok, output };
  if (callId !== undefined) {
    const forId = callIdToEntryId.get(callId);
    if (forId !== undefined) payload.for_id = forId;
  }
  const entry: Entry = {
    type: "tool_result",
    id: randomUUID(),
    ts,
    payload,
    source: { agent: AGENT_NAME, original_type: "response_item.function_call_output" },
    meta: { "dev.codex.raw_type": "response_item.function_call_output" },
  };
  if (callId !== undefined) entry.semantic = { call_id: callId };
  return entry;
}

function normaliseReasoningText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildReasoningEntry(rec: Classified, ts: string): Entry | undefined {
  const text = stringValue(rec.payload.text) ?? stringValue(rec.payload.message);
  if (text === undefined || text.length === 0) return undefined;
  const rawType =
    rec.payloadType === "agent_reasoning_raw_content"
      ? "event_msg.agent_reasoning_raw_content"
      : "event_msg.agent_reasoning";
  return {
    type: "agent_thinking",
    id: randomUUID(),
    ts,
    payload: { text },
    source: { agent: AGENT_NAME, original_type: rawType },
    meta: { "dev.codex.raw_type": rawType },
  };
}

// Real Codex sessions emit context compaction as a top-level `compacted`
// record (not nested in `event_msg`). The payload carries `message` (the
// summary text) and `replacement_history` (the messages folded into the
// summary). `event_msg.context_compacted` also fires as an empty notification
// marker — PR1 ignores it since the canonical content lives on the top-level
// record. Token counts (tokens_before / tokens_after) are not in the source
// stream; defer to PR2 if they surface in a later session shape.
function buildCompactEntry(rec: Classified, ts: string): Entry | undefined {
  const summary = stringValue(rec.payload.message) ?? stringValue(rec.payload.summary);
  if (summary === undefined || summary.length === 0) return undefined;
  const payload: Record<string, unknown> = { summary, trigger: "auto" };
  const tokensBefore = numericValue(rec.payload.tokens_before);
  if (tokensBefore !== undefined) payload.tokens_before = Math.trunc(tokensBefore);
  const tokensAfter = numericValue(rec.payload.tokens_after);
  if (tokensAfter !== undefined) payload.tokens_after = Math.trunc(tokensAfter);
  return {
    type: "context_compact",
    id: randomUUID(),
    ts,
    payload,
    source: { agent: AGENT_NAME, original_type: "compacted" },
    meta: { "dev.codex.raw_type": "compacted" },
  };
}

function buildModelChangeEntry(ts: string, fromModel: string | undefined, toModel: string): Entry {
  const payload: Record<string, unknown> = { to_model: toModel };
  if (fromModel !== undefined) payload.from_model = fromModel;
  return {
    type: "model_change",
    id: randomUUID(),
    ts,
    payload,
    source: {
      agent: AGENT_NAME,
      original_type: "turn_context.model_change",
      synthesized: true,
    },
    meta: { "dev.codex.raw_type": "turn_context.model_change" },
  };
}

function buildEntries(records: Record<string, unknown>[]): Entry[] {
  const entries: Entry[] = [];
  const callIdToEntryId = new Map<string, string>();
  // Reasoning dedupe scope: a turn, identified by the most recent
  // `turn_context.payload.turn_id`. Within a turn, drop reasoning records
  // whose normalised text duplicates one we have already emitted.
  let currentTurnId = "turn-implicit";
  let turnReasoningSeen = new Set<string>();
  let lastModel: string | undefined;
  const resetTurn = (id: string) => {
    currentTurnId = id;
    turnReasoningSeen = new Set<string>();
  };
  for (let i = 1; i < records.length; i += 1) {
    const raw = records[i];
    if (raw === undefined) continue;
    const c = classify(raw);
    if (c === undefined) continue;
    const ts = c.ts;
    if (ts === undefined) continue;
    if (c.topType === "turn_context") {
      const turnId = stringValue(c.payload.turn_id);
      if (turnId !== undefined && turnId !== currentTurnId) resetTurn(turnId);
      const model = stringValue(c.payload.model);
      if (model !== undefined) {
        if (lastModel !== undefined && lastModel !== model) {
          entries.push(buildModelChangeEntry(ts, lastModel, model));
        }
        lastModel = model;
      }
      continue;
    }
    if (c.topType === "compacted") {
      const entry = buildCompactEntry(c, ts);
      if (entry !== undefined) entries.push(entry);
      continue;
    }
    if (c.topType === "response_item") {
      if (c.payloadType === "function_call") {
        const { entry, callId } = buildToolCallEntry(c, ts);
        entries.push(entry);
        if (callId !== undefined) callIdToEntryId.set(callId, entry.id);
        continue;
      }
      if (c.payloadType === "function_call_output") {
        entries.push(buildToolResultEntry(c, ts, callIdToEntryId));
        continue;
      }
      continue;
    }
    if (c.topType === "event_msg") {
      if (c.payloadType === "user_message" || c.payloadType === "agent_message") {
        const entry = buildUserOrAgentMessageEntry(c, ts);
        if (entry !== undefined) entries.push(entry);
        continue;
      }
      if (c.payloadType === "agent_reasoning" || c.payloadType === "agent_reasoning_raw_content") {
        const entry = buildReasoningEntry(c, ts);
        if (entry === undefined) continue;
        const text = stringValue((entry.payload as { text: string }).text) ?? "";
        const key = normaliseReasoningText(text);
        if (key.length === 0 || turnReasoningSeen.has(key)) continue;
        turnReasoningSeen.add(key);
        entries.push(entry);
      }
      // `event_msg.context_compacted` is a notification marker only — the
      // canonical compaction record is the top-level `compacted` envelope.
      // All other event_msg payload types (task_started, token_count,
      // exec_command_end, thread_goal_updated, etc.) are PR2 hardening.
    }
  }
  return entries;
}

export function parseCodexJsonl(text: string): TrailFile {
  const records = parseLines(text);
  if (records.length === 0) {
    throw new Error("Codex session is empty");
  }
  const first = records[0];
  if (first === undefined) throw new Error("Codex session is empty");
  const header = buildHeader(first);
  const entries = buildEntries(records);
  return { header, entries };
}
