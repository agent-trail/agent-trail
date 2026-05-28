// Codex CLI rollout-JSONL parser (issue #32 PR1 tracer slice).
//
// Scope: minimal mapping for `user_message`, `agent_message`, `tool_call`,
// `tool_result`, `agent_thinking`, `context_compact`, `model_change`. See
// `docs/parser-source-matrix.md` for the full PR1 mapping table and the list
// of deferred shapes. `user_interrupt` synthesis is intentionally deferred:
// no real Codex session observed on the verifying contributor's machine
// (codex-tui 0.128.x / Codex Desktop 0.133.x-alpha / codex_sdk_ts 0.98.x)
// emits a native interrupt envelope — see deferred-shapes section of the
// matrix doc. PR2 hardening tracks recovery if a signal surfaces.
//
// Idempotence: entry ids derive deterministically from
// (session_uid, record_index, entry_type) per spec §8.5, so re-parsing the
// same JSONL produces stable ids and the reconciler can group segments.
import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import {
  CODEX_ENTRY_ID_NAMESPACE,
  CODEX_SESSION_UID_NAMESPACE,
  deriveSessionUid,
  deriveSynthesizedEntryId,
} from "../session-uid.ts";
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

function entryId(sessionUid: string, index: number, kind: string): string {
  return deriveSynthesizedEntryId(CODEX_ENTRY_ID_NAMESPACE, [sessionUid, String(index), kind]);
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
function buildUserOrAgentMessageEntry(rec: Classified, ts: string, id: string): Entry | undefined {
  const text = stringValue(rec.payload.message) ?? stringValue(rec.payload.text);
  if (text === undefined || text.length === 0) return undefined;
  if (rec.payloadType === "user_message") {
    return {
      type: "user_message",
      id,
      ts,
      payload: { text },
      source: { agent: AGENT_NAME, original_type: "event_msg.user_message" },
      meta: { "dev.codex.raw_type": "event_msg.user_message" },
    };
  }
  if (rec.payloadType === "agent_message") {
    return {
      type: "agent_message",
      id,
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
// POSIX-safe shell quoting. Identical to Pi's helper
// (`packages/adapters/src/pi/tools.ts:7`) — kept inline to avoid pulling Pi
// internals into the codex adapter.
function quoteShellArg(value: string): string {
  return /^[A-Za-z0-9_\-./@:+=]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellCommandFromArgs(args: Record<string, unknown>): string | undefined {
  const cmd = args.cmd;
  if (typeof cmd === "string") return cmd;
  const command = args.command;
  if (typeof command === "string") return command;
  if (Array.isArray(command)) {
    const parts = command.filter((p): p is string => typeof p === "string");
    if (parts.length === 0) return undefined;
    return parts.map(quoteShellArg).join(" ");
  }
  return undefined;
}

function mapTool(rawName: string | undefined, rawArgs: unknown): ToolMapping {
  const args = isObject(rawArgs) ? rawArgs : {};
  // `exec_command` is the canonical interactive-shell tool in real Codex
  // rollouts (codex-tui 0.128+, Codex Desktop 0.133+). Args carry `cmd`
  // plus `workdir` and a forward-compat set of permission / timing fields
  // (`yield_time_ms`, `max_output_tokens`, `justification`,
  // `sandbox_permissions`, `prefix_rule`, `login`, `tty`); ignore extras.
  // `shell` / `container.exec` are kept as defensive fallbacks for older
  // session shapes.
  if (rawName === "exec_command" || rawName === "shell" || rawName === "container.exec") {
    const cmdString = shellCommandFromArgs(args);
    if (cmdString !== undefined) {
      const shellArgs: Record<string, unknown> = { command: cmdString };
      const cwd = stringValue(args.workdir) ?? stringValue(args.cwd);
      if (cwd !== undefined) shellArgs.cwd = cwd;
      return { tool: "shell_command", args: shellArgs };
    }
    return { tool: "other", args: { name: rawName, args } };
  }
  if (rawName === "read") {
    const path = stringValue(args.path);
    if (path !== undefined) return { tool: "file_read", args: { path } };
  }
  return { tool: "other", args: { name: rawName ?? "unknown", args } };
}

// Match the canonical apply_patch envelope marker. Patches look like:
//   *** Begin Patch
//   *** Update File: <path>
//   @@ ...
//   *** End Patch
// Three verbs cover create / modify / delete: Update, Add, Delete.
const PATCH_FILE_MARKER = /^\*\*\* (Update|Add|Delete) File: (.+)$/gm;

function patchSingleFilePath(input: string): string | undefined {
  const paths = new Set<string>();
  for (const m of input.matchAll(PATCH_FILE_MARKER)) {
    const path = m[2]?.trim();
    if (path !== undefined && path.length > 0) paths.add(path);
    if (paths.size > 1) return undefined;
  }
  if (paths.size === 1) {
    const [only] = paths;
    return only;
  }
  return undefined;
}

// Strip `tools.` prefix per issue body's `canonical_tool_name` rule (defensive
// only — no real session observed with the prefix, but the spec mandates it).
function canonicalCustomToolName(name: string | undefined): string {
  if (name === undefined) return "unknown";
  return name.startsWith("tools.") ? name.slice("tools.".length) : name;
}

type ParsedArgs = {
  args: Record<string, unknown>;
  rawUnparseable?: string;
};

function parseFunctionArguments(raw: unknown): ParsedArgs {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return { args: isObject(parsed) ? parsed : {} };
    } catch {
      // Preserve the unparseable string so debuggers can still see what
      // Codex emitted; `source.raw` carries it on the tool_call entry.
      return { args: {}, rawUnparseable: raw };
    }
  }
  if (isObject(raw)) return { args: raw };
  return { args: {} };
}

function buildToolCallEntry(
  rec: Classified,
  ts: string,
  id: string,
): {
  entry: Entry;
  callId: string | undefined;
} {
  const name = stringValue(rec.payload.name);
  const callId = stringValue(rec.payload.call_id);
  const parsed = parseFunctionArguments(rec.payload.arguments);
  const mapping = mapTool(name, parsed.args);
  const source: Record<string, unknown> = {
    agent: AGENT_NAME,
    original_type: "response_item.function_call",
  };
  if (parsed.rawUnparseable !== undefined) {
    source.raw = { arguments: parsed.rawUnparseable };
  }
  const entry: Entry = {
    type: "tool_call",
    id,
    ts,
    payload: { tool: mapping.tool, args: mapping.args },
    source: source as Entry["source"],
    meta: { "dev.codex.raw_type": "response_item.function_call" },
  };
  if (callId !== undefined) {
    entry.semantic = { call_id: callId, tool_kind: mapping.tool };
  } else {
    entry.semantic = { tool_kind: mapping.tool };
  }
  return { entry, callId };
}

// `web_search_call` carries no `call_id` in the response_item channel; the
// matching `event_msg.web_search_end` carries a `ws_*`-prefixed id that
// cannot be derived from the request. Pair via the action.queries[0] / .query
// string in PR2; consumers join by matching the entry's args.query against
// `event_msg.web_search_end.payload.query` (system_event emitted with that
// query under semantic.call_id is the bridge). action.type==="search"
// becomes web_search; everything else falls through to `other` since we have
// no URL to populate web_fetch's required `args.url`.
function buildWebSearchCallEntry(
  rec: Classified,
  ts: string,
  id: string,
): { entry: Entry; query: string | undefined } {
  const action = isObject(rec.payload.action) ? rec.payload.action : {};
  const actionType = stringValue(action.type);
  const queries = Array.isArray(action.queries) ? action.queries : [];
  const firstQuery = queries.find((q): q is string => typeof q === "string");
  const query = firstQuery ?? stringValue(action.query);
  let payload: Record<string, unknown>;
  let tool: "web_search" | "other";
  if (actionType === "search" && query !== undefined) {
    tool = "web_search";
    payload = { tool, args: { query } };
  } else {
    tool = "other";
    payload = { tool, args: { name: "web_search_call", args: { action } } };
  }
  const entry: Entry = {
    type: "tool_call",
    id,
    ts,
    payload,
    source: { agent: AGENT_NAME, original_type: "response_item.web_search_call" },
    meta: { "dev.codex.raw_type": "response_item.web_search_call" },
    semantic: { tool_kind: tool },
  };
  return { entry, query };
}

// `custom_tool_call` is a sibling channel to `function_call` — the request
// carries raw string `input` (e.g. an apply_patch text body) instead of a JSON
// `arguments` string. Schema dispatch:
//   - name == "apply_patch", single-file patch → file_edit{path, diff}
//   - everything else → other{name, args:{input}}
function buildCustomToolCallEntry(
  rec: Classified,
  ts: string,
  id: string,
): { entry: Entry; callId: string | undefined } {
  const rawName = stringValue(rec.payload.name);
  const callId = stringValue(rec.payload.call_id);
  const input = stringValue(rec.payload.input) ?? "";
  const canonicalName = canonicalCustomToolName(rawName);
  let mapping: ToolMapping;
  if (canonicalName === "apply_patch") {
    const path = patchSingleFilePath(input);
    if (path !== undefined) {
      mapping = { tool: "file_edit", args: { path, diff: input } };
    } else {
      mapping = { tool: "other", args: { name: canonicalName, args: { input } } };
    }
  } else {
    mapping = { tool: "other", args: { name: canonicalName, args: { input } } };
  }
  const entry: Entry = {
    type: "tool_call",
    id,
    ts,
    payload: { tool: mapping.tool, args: mapping.args },
    source: { agent: AGENT_NAME, original_type: "response_item.custom_tool_call" },
    meta: { "dev.codex.raw_type": "response_item.custom_tool_call" },
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
  id: string,
  callIdToEntryId: Map<string, string>,
  rawType:
    | "response_item.function_call_output"
    | "response_item.custom_tool_call_output" = "response_item.function_call_output",
): Entry {
  const callId = stringValue(rec.payload.call_id);
  const rawOutput = rec.payload.output;
  const outputRaw =
    typeof rawOutput === "string"
      ? rawOutput
      : rawOutput === undefined
        ? ""
        : JSON.stringify(rawOutput);
  const output = stripSpinner(outputRaw);
  const ok = !isObject(rec.payload) || rec.payload.success !== false;
  const payload: Record<string, unknown> = { ok, output };
  if (callId !== undefined) {
    const forId = callIdToEntryId.get(callId);
    if (forId !== undefined) payload.for_id = forId;
  }
  const entry: Entry = {
    type: "tool_result",
    id,
    ts,
    payload,
    source: { agent: AGENT_NAME, original_type: rawType },
    meta: { "dev.codex.raw_type": rawType },
  };
  if (callId !== undefined) entry.semantic = { call_id: callId };
  return entry;
}

// Dedup key only — destroys structure. The entry body keeps the original
// `text` verbatim so consumers see Codex's actual reasoning formatting.
function reasoningDedupKey(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildReasoningEntry(rec: Classified, ts: string, id: string): Entry | undefined {
  const text = stringValue(rec.payload.text) ?? stringValue(rec.payload.message);
  if (text === undefined || text.length === 0) return undefined;
  const rawType =
    rec.payloadType === "agent_reasoning_raw_content"
      ? "event_msg.agent_reasoning_raw_content"
      : "event_msg.agent_reasoning";
  return {
    type: "agent_thinking",
    id,
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
function buildCompactEntry(rec: Classified, ts: string, id: string): Entry | undefined {
  const summary = stringValue(rec.payload.message) ?? stringValue(rec.payload.summary);
  if (summary === undefined || summary.length === 0) return undefined;
  const payload: Record<string, unknown> = { summary, trigger: "auto" };
  const tokensBefore = numericValue(rec.payload.tokens_before);
  if (tokensBefore !== undefined) payload.tokens_before = Math.trunc(tokensBefore);
  const tokensAfter = numericValue(rec.payload.tokens_after);
  if (tokensAfter !== undefined) payload.tokens_after = Math.trunc(tokensAfter);
  return {
    type: "context_compact",
    id,
    ts,
    payload,
    source: { agent: AGENT_NAME, original_type: "compacted" },
    meta: { "dev.codex.raw_type": "compacted" },
  };
}

// Strip Codex spinner-glyph noise from tool-result output. Real Codex outputs
// often end with `\n· ` (TUI's "in progress" marker leaked into the
// transcript). We only strip when the trim region contains at least one of
// the unambiguous spinner decorations (`·`, `•`) — natural trailing
// whitespace like a shell command's `\n` stays untouched. Cap to 8 chars per
// side so real content is never eaten.
const SPINNER_GLYPH = /[·•]/;
const SPINNER_OR_WHITESPACE = /[\s·•]/;
const SPINNER_MAX_TRIM = 8;
function trimSpinnerEnd(text: string): string {
  const candidate = text.slice(Math.max(0, text.length - SPINNER_MAX_TRIM));
  if (!SPINNER_GLYPH.test(candidate)) return text;
  let end = text.length;
  let trimmed = 0;
  while (end > 0 && trimmed < SPINNER_MAX_TRIM && SPINNER_OR_WHITESPACE.test(text[end - 1] ?? "")) {
    end -= 1;
    trimmed += 1;
  }
  return text.slice(0, end);
}
function trimSpinnerStart(text: string): string {
  const candidate = text.slice(0, SPINNER_MAX_TRIM);
  if (!SPINNER_GLYPH.test(candidate)) return text;
  let start = 0;
  let trimmed = 0;
  while (
    start < text.length &&
    trimmed < SPINNER_MAX_TRIM &&
    SPINNER_OR_WHITESPACE.test(text[start] ?? "")
  ) {
    start += 1;
    trimmed += 1;
  }
  return text.slice(start);
}
function stripSpinner(text: string): string {
  return trimSpinnerEnd(trimSpinnerStart(text));
}

// Truncate large output blobs (stdout / stderr can run into megabytes) before
// stamping them onto a system_event. Caps at ~2KB so trails stay scannable;
// full payload remains preserved upstream via source.raw policy.
const EXCERPT_CAP_BYTES = 2048;
function excerpt(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= EXCERPT_CAP_BYTES) return text;
  return `${text.slice(0, EXCERPT_CAP_BYTES)}…`;
}

// Codex emits `duration` as either `{secs, nanos}` (Rust serde default) or a
// plain number of milliseconds. Normalise to integer ms.
function durationToMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (!isObject(value)) return undefined;
  const secs = numericValue(value.secs) ?? 0;
  const nanos = numericValue(value.nanos) ?? 0;
  const ms = secs * 1000 + Math.round(nanos / 1_000_000);
  return Number.isFinite(ms) ? ms : undefined;
}

function buildExecCommandEndData(payload: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const turnId = stringValue(payload.turn_id);
  if (turnId !== undefined) data.turn_id = turnId;
  const command = stringValue(payload.command);
  if (command !== undefined) data.command = command;
  const cwd = stringValue(payload.cwd);
  if (cwd !== undefined) data.cwd = cwd;
  const exitCode = numericValue(payload.exit_code);
  if (exitCode !== undefined) data.exit_code = Math.trunc(exitCode);
  const durationMs = durationToMs(payload.duration);
  if (durationMs !== undefined) data.duration_ms = durationMs;
  const stdoutE = excerpt(stringValue(payload.stdout));
  if (stdoutE !== undefined) data.stdout_excerpt = stdoutE;
  const stderrE = excerpt(stringValue(payload.stderr));
  if (stderrE !== undefined) data.stderr_excerpt = stderrE;
  const status = stringValue(payload.status);
  if (status !== undefined) data.status = status;
  const parsed = payload.parsed_cmd;
  if (Array.isArray(parsed)) data.parsed_cmd = parsed;
  return data;
}

// Lifecycle-vocabulary system_event builder. `kind` is the reserved §9.3 token
// (e.g. `task_started`) or a vendor `x-codex/<name>` form when the source has
// no canonical analogue. `data` carries the source payload's structured fields
// (sanitised to JSON-safe values upstream). `linkedCallId`, when present, is
// surfaced as `semantic.call_id` so consumers can join the system_event to
// its originating `tool_call`.
function buildSystemEventEntry(opts: {
  id: string;
  ts: string;
  kind: string;
  rawType: string;
  data?: Record<string, unknown>;
  text?: string;
  linkedCallId?: string;
}): Entry {
  const payload: Record<string, unknown> = { kind: opts.kind };
  if (opts.text !== undefined) payload.text = opts.text;
  if (opts.data !== undefined && Object.keys(opts.data).length > 0) payload.data = opts.data;
  const entry: Entry = {
    type: "system_event",
    id: opts.id,
    ts: opts.ts,
    payload,
    source: { agent: AGENT_NAME, original_type: opts.rawType },
    meta: { "dev.codex.raw_type": opts.rawType },
  };
  if (opts.linkedCallId !== undefined) {
    entry.semantic = { call_id: opts.linkedCallId };
  }
  return entry;
}

function buildModelChangeEntry(
  ts: string,
  id: string,
  fromModel: string | undefined,
  toModel: string,
): Entry {
  const payload: Record<string, unknown> = { to_model: toModel };
  if (fromModel !== undefined) payload.from_model = fromModel;
  return {
    type: "model_change",
    id,
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

function buildEntries(records: Record<string, unknown>[], sessionUid: string): Entry[] {
  const entries: Entry[] = [];
  const callIdToEntryId = new Map<string, string>();
  // web_search_call → web_search_end pairing is by query string, not call_id.
  const queryToEntryId = new Map<string, string>();
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
          const id = entryId(sessionUid, i, "model_change");
          entries.push(buildModelChangeEntry(ts, id, lastModel, model));
        }
        lastModel = model;
      }
      continue;
    }
    if (c.topType === "compacted") {
      const id = entryId(sessionUid, i, "context_compact");
      const entry = buildCompactEntry(c, ts, id);
      if (entry !== undefined) entries.push(entry);
      continue;
    }
    if (c.topType === "response_item") {
      if (c.payloadType === "reasoning") {
        // Codex `response_item.reasoning` payloads carry an opaque
        // `encrypted_content` blob and may include a plaintext `summary`
        // array. Emit agent_thinking only when the summary surfaces real
        // text; encrypted-only records have nothing to map. Dedupe applies
        // per-turn against the event_msg reasoning surfaces.
        const summary = c.payload.summary;
        if (Array.isArray(summary)) {
          const text = summary
            .filter(isObject)
            .map((item) => stringValue((item as Record<string, unknown>).text))
            .filter((t): t is string => t !== undefined && t.length > 0)
            .join("\n");
          if (text.length > 0) {
            const key = reasoningDedupKey(text);
            if (!turnReasoningSeen.has(key)) {
              turnReasoningSeen.add(key);
              const id = entryId(sessionUid, i, "agent_thinking");
              entries.push({
                type: "agent_thinking",
                id,
                ts,
                payload: { text },
                source: {
                  agent: AGENT_NAME,
                  original_type: "response_item.reasoning.summary",
                },
                meta: { "dev.codex.raw_type": "response_item.reasoning.summary" },
              });
            }
          }
        }
        continue;
      }
      if (c.payloadType === "function_call") {
        const id = entryId(sessionUid, i, "tool_call");
        const { entry, callId } = buildToolCallEntry(c, ts, id);
        entries.push(entry);
        if (callId !== undefined) callIdToEntryId.set(callId, entry.id);
        continue;
      }
      if (c.payloadType === "function_call_output") {
        const id = entryId(sessionUid, i, "tool_result");
        entries.push(buildToolResultEntry(c, ts, id, callIdToEntryId));
        continue;
      }
      if (c.payloadType === "custom_tool_call") {
        const id = entryId(sessionUid, i, "tool_call");
        const { entry, callId } = buildCustomToolCallEntry(c, ts, id);
        entries.push(entry);
        if (callId !== undefined) callIdToEntryId.set(callId, entry.id);
        continue;
      }
      if (c.payloadType === "custom_tool_call_output") {
        const id = entryId(sessionUid, i, "tool_result");
        entries.push(
          buildToolResultEntry(c, ts, id, callIdToEntryId, "response_item.custom_tool_call_output"),
        );
        continue;
      }
      if (c.payloadType === "web_search_call") {
        const id = entryId(sessionUid, i, "tool_call");
        const { entry, query } = buildWebSearchCallEntry(c, ts, id);
        entries.push(entry);
        if (query !== undefined) queryToEntryId.set(query, entry.id);
        continue;
      }
      if (c.payloadType === "tool_search_call") {
        const id = entryId(sessionUid, i, "tool_call");
        const callId = stringValue(c.payload.call_id);
        const parsed = parseFunctionArguments(c.payload.arguments);
        const args: Record<string, unknown> = {
          name: "tool_search",
          args: parsed.args,
        };
        const source: Record<string, unknown> = {
          agent: AGENT_NAME,
          original_type: "response_item.tool_search_call",
        };
        if (parsed.rawUnparseable !== undefined) {
          source.raw = { arguments: parsed.rawUnparseable };
        }
        const entry: Entry = {
          type: "tool_call",
          id,
          ts,
          payload: { tool: "other", args },
          source: source as Entry["source"],
          meta: { "dev.codex.raw_type": "response_item.tool_search_call" },
        };
        if (callId !== undefined) {
          entry.semantic = { call_id: callId, tool_kind: "other" };
        } else {
          entry.semantic = { tool_kind: "other" };
        }
        entries.push(entry);
        if (callId !== undefined) callIdToEntryId.set(callId, entry.id);
        continue;
      }
      if (c.payloadType === "tool_search_output") {
        const id = entryId(sessionUid, i, "tool_result");
        const callId = stringValue(c.payload.call_id);
        // `tools` array is the canonical output; serialise to a JSON string so
        // it satisfies tool_result.payload.output (which requires a string).
        const output = Array.isArray(c.payload.tools)
          ? JSON.stringify(c.payload.tools)
          : (stringValue(c.payload.output) ?? "");
        const payload: Record<string, unknown> = { ok: true, output };
        if (callId !== undefined) {
          const forId = callIdToEntryId.get(callId);
          if (forId !== undefined) payload.for_id = forId;
        }
        const entry: Entry = {
          type: "tool_result",
          id,
          ts,
          payload,
          source: { agent: AGENT_NAME, original_type: "response_item.tool_search_output" },
          meta: { "dev.codex.raw_type": "response_item.tool_search_output" },
        };
        if (callId !== undefined) entry.semantic = { call_id: callId };
        entries.push(entry);
        continue;
      }
      continue;
    }
    if (c.topType === "event_msg") {
      if (c.payloadType === "user_message" || c.payloadType === "agent_message") {
        const id = entryId(sessionUid, i, c.payloadType);
        const entry = buildUserOrAgentMessageEntry(c, ts, id);
        if (entry !== undefined) entries.push(entry);
        continue;
      }
      if (c.payloadType === "agent_reasoning" || c.payloadType === "agent_reasoning_raw_content") {
        const id = entryId(sessionUid, i, "agent_thinking");
        const entry = buildReasoningEntry(c, ts, id);
        if (entry === undefined) continue;
        const text = stringValue((entry.payload as { text: string }).text) ?? "";
        const key = reasoningDedupKey(text);
        if (key.length === 0 || turnReasoningSeen.has(key)) continue;
        turnReasoningSeen.add(key);
        entries.push(entry);
      }
      if (c.payloadType === "task_complete") {
        const id = entryId(sessionUid, i, "system_event:task_completed");
        const data: Record<string, unknown> = {};
        const turnId = stringValue(c.payload.turn_id);
        if (turnId !== undefined) data.turn_id = turnId;
        const completedAt = numericValue(c.payload.completed_at);
        if (completedAt !== undefined) data.completed_at = completedAt;
        const durationMs = numericValue(c.payload.duration_ms);
        if (durationMs !== undefined) data.duration_ms = Math.trunc(durationMs);
        const ttft = numericValue(c.payload.time_to_first_token_ms);
        if (ttft !== undefined) data.time_to_first_token_ms = Math.trunc(ttft);
        const lastMessage = stringValue(c.payload.last_agent_message);
        if (lastMessage !== undefined) data.last_agent_message = lastMessage;
        entries.push(
          buildSystemEventEntry({
            id,
            ts,
            kind: "task_completed",
            rawType: "event_msg.task_complete",
            data,
          }),
        );
        continue;
      }
      if (c.payloadType === "exec_command_end") {
        const id = entryId(sessionUid, i, "system_event:exec_command_end");
        const data = buildExecCommandEndData(c.payload);
        entries.push(
          buildSystemEventEntry({
            id,
            ts,
            kind: "x-codex/exec_command_end",
            rawType: "event_msg.exec_command_end",
            data,
            linkedCallId: stringValue(c.payload.call_id),
          }),
        );
        continue;
      }
      if (c.payloadType === "patch_apply_end") {
        const id = entryId(sessionUid, i, "system_event:patch_apply_end");
        const data: Record<string, unknown> = {};
        const success = c.payload.success;
        if (typeof success === "boolean") data.success = success;
        const changes = c.payload.changes;
        if (isObject(changes)) data.changes = changes;
        const stdoutE = excerpt(stringValue(c.payload.stdout));
        if (stdoutE !== undefined) data.stdout_excerpt = stdoutE;
        const stderrE = excerpt(stringValue(c.payload.stderr));
        if (stderrE !== undefined) data.stderr_excerpt = stderrE;
        const status = stringValue(c.payload.status);
        if (status !== undefined) data.status = status;
        entries.push(
          buildSystemEventEntry({
            id,
            ts,
            kind: "x-codex/patch_apply_end",
            rawType: "event_msg.patch_apply_end",
            data,
            linkedCallId: stringValue(c.payload.call_id),
          }),
        );
        continue;
      }
      if (c.payloadType === "mcp_tool_call_end") {
        const id = entryId(sessionUid, i, "system_event:mcp_tool_call_end");
        const data: Record<string, unknown> = {};
        const pluginId = stringValue(c.payload.plugin_id);
        if (pluginId !== undefined) data.plugin_id = pluginId;
        const invocation = c.payload.invocation;
        if (isObject(invocation)) data.invocation = invocation;
        const duration = durationToMs(c.payload.duration);
        if (duration !== undefined) data.duration_ms = duration;
        const result = c.payload.result;
        if (isObject(result)) {
          // `result` shapes as `{Ok: …}` / `{Err: …}` Rust-style enum.
          data.result_ok = "Ok" in result;
        }
        entries.push(
          buildSystemEventEntry({
            id,
            ts,
            kind: "x-codex/mcp_tool_call_end",
            rawType: "event_msg.mcp_tool_call_end",
            data,
            linkedCallId: stringValue(c.payload.call_id),
          }),
        );
        continue;
      }
      if (c.payloadType === "thread_goal_updated") {
        const id = entryId(sessionUid, i, "system_event:thread_goal_updated");
        const data: Record<string, unknown> = {};
        const threadId = stringValue(c.payload.threadId) ?? stringValue(c.payload.thread_id);
        if (threadId !== undefined) data.thread_id = threadId;
        const turnId = stringValue(c.payload.turnId) ?? stringValue(c.payload.turn_id);
        if (turnId !== undefined) data.turn_id = turnId;
        const goal = c.payload.goal;
        if (isObject(goal)) data.goal = goal;
        entries.push(
          buildSystemEventEntry({
            id,
            ts,
            kind: "x-codex/thread_goal_updated",
            rawType: "event_msg.thread_goal_updated",
            data,
          }),
        );
        continue;
      }
      if (c.payloadType === "task_started") {
        const id = entryId(sessionUid, i, "system_event:task_started");
        const data: Record<string, unknown> = {};
        const turnId = stringValue(c.payload.turn_id);
        if (turnId !== undefined) data.turn_id = turnId;
        const startedAt = numericValue(c.payload.started_at);
        if (startedAt !== undefined) data.started_at = startedAt;
        const contextWindow = numericValue(c.payload.model_context_window);
        if (contextWindow !== undefined) data.model_context_window = Math.trunc(contextWindow);
        const collabMode = stringValue(c.payload.collaboration_mode_kind);
        if (collabMode !== undefined) data.collaboration_mode_kind = collabMode;
        entries.push(
          buildSystemEventEntry({
            id,
            ts,
            kind: "task_started",
            rawType: "event_msg.task_started",
            data,
          }),
        );
        continue;
      }
      if (c.payloadType === "web_search_end") {
        const id = entryId(sessionUid, i, "system_event:web_search_end");
        const query = stringValue(c.payload.query);
        const action = isObject(c.payload.action) ? c.payload.action : undefined;
        const data: Record<string, unknown> = {};
        if (query !== undefined) data.query = query;
        if (action !== undefined) data.action = action;
        entries.push(
          buildSystemEventEntry({
            id,
            ts,
            kind: "x-codex/web_search_end",
            rawType: "event_msg.web_search_end",
            data,
            linkedCallId: stringValue(c.payload.call_id),
          }),
        );
      }
      // `event_msg.context_compacted` is a notification marker only — the
      // canonical compaction record is the top-level `compacted` envelope.
      // Other event_msg payload types (token_count, etc.) intentionally
      // unhandled (see matrix prose).
    }
  }
  return entries;
}

export function parseCodexJsonl(text: string): TrailFile {
  const records = parseLines(text);
  // `buildHeader` is the single source of truth for the empty / wrong-first
  // -record error; relying on it removes a redundant explicit check that
  // duplicated the throw path.
  const first = records[0] ?? {};
  const header = buildHeader(first as Record<string, unknown>);
  // `buildHeader` always emits `session_uid` for Codex (derived from
  // `payload.id`); narrow the optional schema field for the parser side.
  const sessionUid = header.session_uid ?? header.id;
  const entries = buildEntries(records, sessionUid);
  return { header, entries };
}
