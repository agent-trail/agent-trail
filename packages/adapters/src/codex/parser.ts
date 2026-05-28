import { randomUUID } from "node:crypto";
import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import { CODEX_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import {
  type CodexFormat,
  detectFormat,
  isObject,
  numericValue,
  parseLines,
  stringValue,
  timestampToIso,
} from "./source.ts";

const AGENT_NAME = "codex-cli";

function buildDesktopHeader(first: Record<string, unknown>): Header {
  const payload = isObject(first.payload) ? first.payload : {};
  const id = stringValue(payload.id);
  const ts = timestampToIso(payload.timestamp) ?? timestampToIso(first.timestamp);
  if (id === undefined) throw new Error("Codex desktop session_meta missing payload.id");
  if (ts === undefined) throw new Error("Codex desktop session_meta missing timestamp");
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

function buildLegacyHeader(first: Record<string, unknown>): Header {
  const id = stringValue(first.id);
  const ts = timestampToIso(first.timestamp);
  if (id === undefined) throw new Error("Codex legacy session header missing id");
  if (ts === undefined) throw new Error("Codex legacy session header missing timestamp");
  const cliVersion = stringValue(first.cli_version);
  const cwd = stringValue(first.cwd);
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

// Codex content blocks are objects like
//   {type:"input_text"|"output_text"|"text", text:"..."}
// Concatenate all text-bearing blocks in order, mirroring how Codex's own UI
// renders the assembled message.
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    const text = stringValue(block.text);
    if (text !== undefined) parts.push(text);
  }
  return parts.join("\n");
}

type DesktopRecord = {
  topType: string;
  payloadType: string | undefined;
  payload: Record<string, unknown>;
  ts: string | undefined;
};

function classifyDesktop(record: Record<string, unknown>): DesktopRecord | undefined {
  const topType = stringValue(record.type);
  if (topType === undefined) return undefined;
  const payload = isObject(record.payload) ? record.payload : {};
  const payloadType = stringValue(payload.type);
  const ts = timestampToIso(record.timestamp);
  return { topType, payloadType, payload, ts };
}

function buildMessageEntry(rec: DesktopRecord, ts: string): Entry | undefined {
  const role = stringValue(rec.payload.role);
  const text = textFromContent(rec.payload.content);
  if (text.length === 0) return undefined;
  if (role === "user") {
    return {
      type: "user_message",
      id: randomUUID(),
      ts,
      payload: { text },
      source: { agent: AGENT_NAME, original_type: "response_item.message" },
      meta: { "dev.codex.raw_type": "response_item.message" },
    };
  }
  if (role === "assistant") {
    return {
      type: "agent_message",
      id: randomUUID(),
      ts,
      payload: { text },
      source: { agent: AGENT_NAME, original_type: "response_item.message" },
      meta: { "dev.codex.raw_type": "response_item.message" },
    };
  }
  return undefined;
}

type ToolMapping = {
  tool: "shell_command" | "file_read" | "file_edit" | "other";
  args: Record<string, unknown>;
};

// Canonical tool-kind dispatch. PR1 covers the three kinds the issue body's
// PR1 acceptance enumerates: `shell` → `shell_command`, `read` → `file_read`,
// `apply_patch` → `file_edit` (deferred — patch path inference is PR2, so we
// downgrade to `other` to stay schema-valid). Anything else → `other`.
function mapTool(rawName: string | undefined, rawArgs: unknown): ToolMapping {
  const args = isObject(rawArgs) ? rawArgs : {};
  if (rawName === "shell" || rawName === "container.exec") {
    const cmdString = stringValue(args.cmd) ?? stringValue(args.command);
    if (cmdString !== undefined) {
      return { tool: "shell_command", args: { command: cmdString } };
    }
    // Unknown arg shape; defer to PR2 hardening for argv-form parsing.
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
  rec: DesktopRecord,
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
  rec: DesktopRecord,
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

function normalizeReasoningText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildReasoningEntry(rec: DesktopRecord, ts: string): Entry | undefined {
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

function buildCompactEntry(rec: DesktopRecord, ts: string): Entry | undefined {
  const summary = stringValue(rec.payload.summary);
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
    source: { agent: AGENT_NAME, original_type: "event_msg.context_compact" },
    meta: { "dev.codex.raw_type": "event_msg.context_compact" },
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

function buildDesktopEntries(records: Record<string, unknown>[]): Entry[] {
  const entries: Entry[] = [];
  const callIdToEntryId = new Map<string, string>();
  // Reasoning dedupe scope: a turn, identified by the most recent
  // `turn_context.payload.turn_id`. Within a turn, drop reasoning records whose
  // normalised text duplicates one we have already emitted.
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
    const classified = classifyDesktop(raw);
    if (classified === undefined) continue;
    const ts = classified.ts;
    if (ts === undefined) continue;
    if (classified.topType === "turn_context") {
      const turnId = stringValue(classified.payload.turn_id);
      if (turnId !== undefined && turnId !== currentTurnId) resetTurn(turnId);
      const model = stringValue(classified.payload.model);
      if (model !== undefined) {
        if (lastModel !== undefined && lastModel !== model) {
          entries.push(buildModelChangeEntry(ts, lastModel, model));
        }
        lastModel = model;
      }
      continue;
    }
    if (classified.topType === "response_item") {
      if (classified.payloadType === "message") {
        const entry = buildMessageEntry(classified, ts);
        if (entry !== undefined) entries.push(entry);
        continue;
      }
      if (classified.payloadType === "function_call") {
        const { entry, callId } = buildToolCallEntry(classified, ts);
        entries.push(entry);
        if (callId !== undefined) callIdToEntryId.set(callId, entry.id);
        continue;
      }
      if (classified.payloadType === "function_call_output") {
        entries.push(buildToolResultEntry(classified, ts, callIdToEntryId));
        continue;
      }
    }
    if (classified.topType === "event_msg") {
      if (
        classified.payloadType === "agent_reasoning" ||
        classified.payloadType === "agent_reasoning_raw_content"
      ) {
        const entry = buildReasoningEntry(classified, ts);
        if (entry === undefined) continue;
        const text = stringValue((entry.payload as { text: string }).text) ?? "";
        const key = normalizeReasoningText(text);
        if (key.length === 0 || turnReasoningSeen.has(key)) continue;
        turnReasoningSeen.add(key);
        entries.push(entry);
        continue;
      }
      if (classified.payloadType === "context_compact") {
        const entry = buildCompactEntry(classified, ts);
        if (entry !== undefined) entries.push(entry);
      }
    }
  }
  return entries;
}

export type CodexParseResult = TrailFile & { format: CodexFormat };

export function parseCodexJsonl(text: string): CodexParseResult {
  const records = parseLines(text);
  if (records.length === 0) {
    throw new Error("Codex session is empty");
  }
  const first = records[0];
  if (first === undefined) throw new Error("Codex session is empty");
  const format = detectFormat(first);
  if (format === "desktop-wrapped") {
    const header = buildDesktopHeader(first);
    const entries = buildDesktopEntries(records);
    return { header, entries, format };
  }
  const header = buildLegacyHeader(first);
  const entries: Entry[] = [];
  return { header, entries, format };
}
