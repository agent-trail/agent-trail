// Codex CLI rollout-JSONL parser (issue #32).
//
// Scope: mapping for `user_message`, `agent_message`, `tool_call`,
// `tool_result`, `agent_thinking`, `context_compact`, `model_change`, and
// lifecycle / enrichment `system_event` records. See
// `docs/parser-source-matrix.md` for the full mapping table and the list
// of deferred shapes. `user_interrupt` synthesis stays deferred until a
// real interrupt signal surfaces — no real Codex session observed on the
// verifying contributor's machine (codex-tui 0.128.x / Codex Desktop
// 0.133.x-alpha / codex_sdk_ts 0.98.x) emits a native interrupt envelope.
//
// Idempotence: entry ids derive deterministically from
// (session_uid, record_index, entry_type) per spec §8.5, so re-parsing the
// same JSONL produces stable ids and the reconciler can group segments.
import {
  type AgentMessageUsage,
  mapAgentMessageUsage,
  quoteShellArg,
} from "@agent-trail/adapter-kit";
import type { Header } from "@agent-trail/types";
import { CODEX_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import { isObject, numericValue, stringValue, timestampToIso } from "./source.ts";

export const AGENT_NAME = "codex-cli";
// Source-schema package key + vendor kind namespace (short form; the trail
// AgentName is "codex-cli").
export const SOURCE_AGENT = "codex";

export function buildHeader(first: Record<string, unknown>): Header {
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

// `event_msg.user_message` / `event_msg.agent_message` are the canonical user
// and agent surfaces in real sessions (verified against codex-tui 0.128 and
// Codex Desktop 0.133-alpha). Text lives in `payload.message`. The parallel
// `response_item.message` channel carries the same content one record later
// but also includes synthetic `role:"developer"` AGENTS.md preambles that
// shouldn't appear as user input — the adapter currently picks event_msg
// only; cross-channel dedupe is deferred to a later hardening pass.
export type ToolMapping = {
  tool: "shell_command" | "file_read" | "file_edit" | "other";
  args: Record<string, unknown>;
};

// Canonical tool-kind dispatch for `response_item.function_call`. `exec_command`
// (and the older `shell` / `container.exec` aliases) map to `shell_command`;
// `read` maps to `file_read`. Vendor tools we don't recognise fall through to
// `other` to stay schema-valid without claiming canonical kinds we don't yet
// parse end-to-end. `apply_patch` and other custom-channel tools arrive via
// `response_item.custom_tool_call` and are dispatched by `buildCustomToolCallEntry`.
export function shellCommandFromArgs(args: Record<string, unknown>): string | undefined {
  const cmd = args.cmd;
  if (typeof cmd === "string") return cmd;
  const command = args.command;
  if (typeof command === "string") return command;
  if (Array.isArray(command)) {
    const parts = command.filter((p): p is string => typeof p === "string");
    // Source-fidelity: if any argv element is not a string, refuse to
    // reconstruct a partial command rather than silently emit something the
    // source never expressed. Falls through to `other` via the mapTool caller.
    if (parts.length === 0 || parts.length !== command.length) return undefined;
    return parts.map(quoteShellArg).join(" ");
  }
  return undefined;
}

export function mapTool(rawName: string | undefined, rawArgs: unknown): ToolMapping {
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

export function patchSingleFilePath(input: string): string | undefined {
  const paths = new Set<string>();
  for (const m of input.matchAll(PATCH_FILE_MARKER)) {
    // `m[2]` is the second capture group of PATCH_FILE_MARKER and is
    // guaranteed to exist whenever the regex matches.
    const path = (m[2] as string).trim();
    if (path.length > 0) paths.add(path);
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
export function canonicalCustomToolName(name: string | undefined): string {
  if (name === undefined) return "unknown";
  return name.startsWith("tools.") ? name.slice("tools.".length) : name;
}

export type ParsedArgs = {
  args: Record<string, unknown>;
  rawUnparseable?: string;
};

export function parseFunctionArguments(raw: unknown): ParsedArgs {
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

// `web_search_call` carries no `call_id` in the response_item channel; the
// matching `event_msg.web_search_end` carries a `ws_*`-prefixed id that
// cannot be derived from the request. Pairing is query-based: the emitted
// tool_call carries `args.query`, and `web_search_end` (a system_event) keeps
// the same `query` under `payload.data.query`. Consumers join by matching
// those strings. `action.type === "search"` becomes web_search; everything
// else falls through to `other` since we have no URL to populate
// web_fetch's required `args.url`.
// `custom_tool_call` is a sibling channel to `function_call` — the request
// carries raw string `input` (e.g. an apply_patch text body) instead of a JSON
// `arguments` string. Tool-kind dispatch:
//   - name == "apply_patch", single-file patch → file_edit{path, diff}
//   - everything else → other{name, args:{input}}
// Dedup key only — destroys structure. The entry body keeps the original
// `text` verbatim so consumers see Codex's actual reasoning formatting.
export function reasoningDedupKey(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Real Codex sessions emit context compaction as a top-level `compacted`
// record (not nested in `event_msg`). The payload carries `message` (the
// summary text) and `replacement_history` (the messages folded into the
// summary). `event_msg.context_compacted` also fires as an empty notification
// marker — the adapter ignores it since the canonical content lives on the
// top-level record. Token counts (tokens_before / tokens_after) are not in
// the source stream; the optional payload fields stay absent unless a later
// session shape starts to carry them.
// Strip Codex spinner-glyph noise from tool-result output. Real Codex outputs
// often end with `\n· ` (TUI's "in progress" marker leaked into the
// transcript). We only strip when the trim region contains at least one of
// the unambiguous spinner decorations (`·`, `•`) — natural trailing
// whitespace like a shell command's `\n` stays untouched. Cap to 8 chars per
// side so real content is never eaten: this means spinner glyphs sitting
// beyond the 8-char window from either boundary are intentionally preserved
// (a conservative trade-off favouring data fidelity over aggressive
// scrubbing — observed Codex noise always sits within the cap).
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
export function stripSpinner(text: string): string {
  return trimSpinnerEnd(trimSpinnerStart(text));
}

// Truncate large output blobs (stdout / stderr can run into megabytes) before
// stamping them onto a system_event. Caps at ~2KB so trails stay scannable;
// full payload remains preserved upstream via source.raw policy.
const EXCERPT_CAP_BYTES = 2048;
export function excerpt(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= EXCERPT_CAP_BYTES) return text;
  return `${text.slice(0, EXCERPT_CAP_BYTES)}…`;
}

// Codex emits `duration` as either `{secs, nanos}` (Rust serde default) or a
// plain number of milliseconds. Normalise to integer ms.
export function durationToMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (!isObject(value)) return undefined;
  const secs = numericValue(value.secs) ?? 0;
  const nanos = numericValue(value.nanos) ?? 0;
  const ms = secs * 1000 + Math.round(nanos / 1_000_000);
  return Number.isFinite(ms) ? ms : undefined;
}

export function buildExecCommandEndData(payload: Record<string, unknown>): Record<string, unknown> {
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
// `event_msg.token_count` carries token usage under
// `payload.info.{last_token_usage, total_token_usage}`. Translate Codex's
// field names to the spec's `agentMessageUsage` slots before running the
// shared validator: `cached_input_tokens` → `cache_read_tokens` (delta),
// `reasoning_output_tokens` → `reasoning_tokens` (delta). The Codex
// `total_*` counterparts map to `*_cumulative`. Codex's `total_tokens`,
// `cached_input_tokens` cumulative, and `reasoning_output_tokens` cumulative
// have no spec slot and are dropped (input+output remain recoverable).
//
// Returns `undefined` when `payload.info` is null/missing or every translated
// field would be empty — never fabricates zeros (`usage.ts` decision #4).
export function codexUsageFromTokenCount(
  payload: Record<string, unknown>,
): AgentMessageUsage | undefined {
  const info = payload.info;
  if (!isObject(info)) return undefined;
  const last = isObject(info.last_token_usage) ? info.last_token_usage : {};
  const total = isObject(info.total_token_usage) ? info.total_token_usage : {};
  const merged: Record<string, unknown> = {};
  const inputDelta = numericValue(last.input_tokens);
  if (inputDelta !== undefined) merged.input_tokens = inputDelta;
  const outputDelta = numericValue(last.output_tokens);
  if (outputDelta !== undefined) merged.output_tokens = outputDelta;
  const cacheReadDelta = numericValue(last.cached_input_tokens);
  if (cacheReadDelta !== undefined) merged.cache_read_tokens = cacheReadDelta;
  const reasoningDelta = numericValue(last.reasoning_output_tokens);
  if (reasoningDelta !== undefined) merged.reasoning_tokens = reasoningDelta;
  const inputCumulative = numericValue(total.input_tokens);
  if (inputCumulative !== undefined) merged.input_tokens_cumulative = inputCumulative;
  const outputCumulative = numericValue(total.output_tokens);
  if (outputCumulative !== undefined) merged.output_tokens_cumulative = outputCumulative;
  return mapAgentMessageUsage(merged);
}
