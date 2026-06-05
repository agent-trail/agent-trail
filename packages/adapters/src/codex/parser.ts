// Codex CLI rollout-JSONL parser (issue #32).
//
// Scope: mapping for `user_message`, `agent_message`, `tool_call`,
// `tool_result`, `agent_thinking`, `context_compact`, `model_change`, mode /
// thinking-level settings, and lifecycle / enrichment `system_event` records. Codex 0.135
// `event_msg.turn_aborted` maps to `user_interrupt`, and image-bearing
// `response_item.message` records fold into message attachments. See
// `docs/parser-source-matrix.md` for the full mapping table and deferred shapes.
//
// Idempotence: entry ids derive deterministically from
// (session_uid, record_index, entry_type) per spec §8.5, so re-parsing the
// same JSONL produces stable ids and the reconciler can group segments.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  type AgentMessageUsage,
  mapAgentMessageUsage,
  quoteShellArg,
} from "@agent-trail/adapter-kit";
import type { Header, ToolKind } from "@agent-trail/types";
import { CODEX_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import { type HeaderVcs, normalizeRemoteUrl } from "../vcs.ts";
import { isObject, numericValue, stringValue, timestampToIso } from "./source.ts";

export const AGENT_NAME = "codex-cli";
// Source-schema package key + vendor kind namespace (short form; the trail
// AgentName is "codex-cli").
export const SOURCE_AGENT = "codex";

// `SessionMetaLine.git { commit_hash, branch, repository_url }` (Codex
// protocol.rs GitInfo) is the session's recorded VCS ground truth. When
// present it is authoritative — correct for archived / replayed / shared
// trails where the live working tree at `cwd` is stale, missing, or a
// different checkout. `index.ts` only falls back to live `readGitVcs(cwd)`
// when this returns undefined (no recorded `git` block). `repository_url`
// routes through the shared `normalizeRemoteUrl` (strip credentials + `.git`).
export function vcsFromGitInfo(git: unknown): HeaderVcs | undefined {
  if (!isObject(git)) return undefined;
  const revision = stringValue(git.commit_hash);
  if (revision === undefined) return undefined;
  const vcs: HeaderVcs = { type: "git", revision, head_commit: revision };
  const branch = stringValue(git.branch);
  if (branch !== undefined) vcs.branch = branch;
  const remote = normalizeRemoteUrl(git.repository_url);
  if (remote !== undefined) vcs.remote_url = remote;
  return vcs;
}

// `base_instructions` (the session system prompt) is preserved verbatim under
// `source.raw`, but that is elidable at share time. The fingerprint is a cheap
// (~80 byte) curated signal that survives sharing and search: it flags whether
// the prompt was customized (vs the shipped default) and gives a verifiable
// identity, without paying KBs of mostly-boilerplate text in every header.
function baseInstructionsFingerprint(value: unknown): Record<string, unknown> | undefined {
  const text = isObject(value) ? stringValue(value.text) : stringValue(value);
  if (text === undefined) return undefined;
  return {
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

// `SessionMeta.{model_provider, base_instructions, memory_mode}` curated into
// `header.meta` under the adapter's reverse-DNS namespace (matching the
// `dev.codex.*` entry-meta convention). `dynamic_tools` is captured separately
// as a `capability_change` entry, so it is not duplicated here.
function sessionMetaExtras(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const provider = stringValue(payload.model_provider);
  if (provider !== undefined) out["dev.codex.model_provider"] = provider;
  const fingerprint = baseInstructionsFingerprint(payload.base_instructions);
  if (fingerprint !== undefined) out["dev.codex.base_instructions"] = fingerprint;
  const memoryMode = stringValue(payload.memory_mode);
  if (memoryMode !== undefined) out["dev.codex.memory_mode"] = memoryMode;
  return out;
}

export function buildHeader(first: Record<string, unknown>): Header {
  if (first.type !== "session_meta") {
    throw new Error(
      `Codex session must start with type:"session_meta"; got ${JSON.stringify(first.type)}`,
    );
  }
  const payload = isObject(first.payload) ? first.payload : {};
  const id = stringValue(payload.id);
  // Canonical session time is the envelope `RolloutLine.timestamp`; the inner
  // `payload.timestamp` is only a same-record fallback for shapes that omit the
  // envelope stamp (drift-defense: no global inner-payload timestamp ladder).
  const ts = timestampToIso(first.timestamp) ?? timestampToIso(payload.timestamp);
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
  // `git` is a sibling of the flattened SessionMeta fields inside the
  // session_meta payload (SessionMetaLine = flatten(SessionMeta) + git).
  const vcs = vcsFromGitInfo(payload.git);
  if (vcs !== undefined) header.vcs = vcs;
  const extras = sessionMetaExtras(payload);
  if (Object.keys(extras).length > 0) header.meta = extras;
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
// shouldn't appear as user input. Text-only response messages are suppressed;
// image-bearing response messages are folded into the matching event message
// by the kit reconciler.
export type ToolMapping = {
  tool: ToolKind;
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

function idString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function toolSearchArgs(args: Record<string, unknown>): Record<string, unknown> | undefined {
  const query = stringValue(args.query) ?? stringValue(args.q);
  if (query === undefined) return undefined;
  const out: Record<string, unknown> = { query };
  const limit = numericValue(args.limit) ?? numericValue(args.top_k);
  if (limit !== undefined) out.limit = Math.trunc(limit);
  return out;
}

function mcpToolFromName(rawName: string): { server: string; tool: string } | undefined {
  if (!rawName.startsWith("mcp__")) return undefined;
  const [, server, ...toolParts] = rawName.split("__");
  if (server === undefined || toolParts.length === 0) return undefined;
  return { server, tool: toolParts.join("__") };
}

function mcpToolFromArgs(
  rawName: string | undefined,
  args: Record<string, unknown>,
): { server: string; tool: string; selectorKey?: "name" | "tool" } | undefined {
  if (rawName !== undefined) {
    const fromName = mcpToolFromName(rawName);
    if (fromName !== undefined) return fromName;
  }
  const namespace = stringValue(args.namespace);
  if (namespace?.startsWith("mcp__") === true) {
    const server = namespace.slice("mcp__".length);
    const nameTool = stringValue(args.name);
    if (server.length > 0 && nameTool !== undefined) {
      return { server, tool: nameTool, selectorKey: "name" };
    }
    const toolTool = stringValue(args.tool);
    if (server.length > 0 && toolTool !== undefined) {
      return { server, tool: toolTool, selectorKey: "tool" };
    }
  }
  return undefined;
}

function redactedHeaders(headers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.keys(headers).map((key) => [key, "[REDACTED_HEADER]"]));
}

export function mapTool(rawName: string | undefined, rawArgs: unknown): ToolMapping {
  const args = isObject(rawArgs) ? rawArgs : {};
  const mcp = mcpToolFromArgs(rawName, args);
  if (mcp !== undefined) {
    const toolArgs = { ...args };
    const headers = isObject(toolArgs.headers) ? redactedHeaders(toolArgs.headers) : undefined;
    delete toolArgs.headers;
    if (mcp.selectorKey !== undefined) {
      delete toolArgs.namespace;
      delete toolArgs[mcp.selectorKey];
    }
    return {
      tool: "mcp_call",
      args: {
        server: mcp.server,
        tool: mcp.tool,
        args: toolArgs,
        ...(headers !== undefined ? { headers } : {}),
      },
    };
  }
  // `exec_command` is the canonical interactive-shell tool in real Codex
  // rollouts (codex-tui 0.128+, Codex Desktop 0.133+). Args carry `cmd`
  // plus `workdir` and a forward-compat set of permission / timing fields
  // (`yield_time_ms`, `max_output_tokens`, `justification`,
  // `sandbox_permissions`, `prefix_rule`, `login`, `tty`); ignore extras.
  // `shell` / `container.exec` are kept as defensive fallbacks for older
  // session shapes.
  if (
    rawName === "exec_command" ||
    rawName === "shell_command" ||
    rawName === "shell" ||
    rawName === "container.exec"
  ) {
    const cmdString = shellCommandFromArgs(args);
    if (cmdString !== undefined) {
      const shellArgs: Record<string, unknown> = { command: cmdString };
      const cwd = stringValue(args.workdir) ?? stringValue(args.cwd);
      if (cwd !== undefined) shellArgs.cwd = cwd;
      return { tool: "shell_command", args: shellArgs };
    }
    return { tool: "other", args: { name: rawName, args } };
  }
  if (rawName === "write_stdin") {
    const input = stringValue(args.chars);
    const commandId = idString(args.command_id);
    const sessionId = idString(args.session_id);
    if (input !== undefined && input.length > 0) {
      return {
        tool: "shell_input",
        args: {
          input,
          ...(commandId !== undefined ? { command_id: commandId } : {}),
          ...(sessionId !== undefined ? { session_id: sessionId } : {}),
        },
      };
    }
    const outputCommandId = commandId ?? sessionId;
    return {
      tool: "shell_output",
      args: { ...(outputCommandId !== undefined ? { command_id: outputCommandId } : {}) },
    };
  }
  if (rawName === "tool_search") {
    const searchArgs = toolSearchArgs(args);
    if (searchArgs !== undefined) return { tool: "tool_search", args: searchArgs };
  }
  if (rawName === "spawn_agent") {
    const task = stringValue(args.message) ?? stringValue(args.task) ?? "";
    const invokeArgs: Record<string, unknown> = { task };
    const agentType = stringValue(args.agent_type);
    if (agentType !== undefined) invokeArgs.agent_type = agentType;
    return { tool: "subagent_invoke", args: invokeArgs };
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

export type PatchFile = {
  path: string;
  diff: string;
};

function endPatchIndex(input: string, start: number): number {
  const tail = input.slice(start);
  const match = tail.match(/^\*\*\* End Patch\b/m);
  return match?.index === undefined ? -1 : start + match.index;
}

function countPrefixedLines(lines: string[], prefix: string): number {
  return lines.filter((line) => line.startsWith(prefix)).length;
}

function normalizePatchBody(action: "Update" | "Add" | "Delete", body: string): string {
  const diffBody = body
    .split("\n")
    .filter((line) => !line.startsWith("*** Move to:") && line !== "*** End of File")
    .join("\n")
    .trim();
  if (diffBody.length === 0 || /^@@/m.test(diffBody)) return diffBody;

  const lines = diffBody.split("\n");
  const oldCount = action === "Add" ? 0 : countPrefixedLines(lines, "-");
  const newCount = action === "Delete" ? 0 : countPrefixedLines(lines, "+");
  return [`@@ -1,${oldCount} +1,${newCount} @@`, diffBody].join("\n");
}

export function patchFiles(input: string): PatchFile[] {
  const matches = [...input.matchAll(PATCH_FILE_MARKER)];
  return matches
    .map((match, index) => {
      const action = match[1] as "Update" | "Add" | "Delete";
      const path = (match[2] as string).trim();
      if (path.length === 0) return undefined;
      const start = match.index + match[0].length;
      const end = matches[index + 1]?.index ?? endPatchIndex(input, start);
      const body = input.slice(start, end === -1 ? undefined : end).trim();
      const moveTo = body.match(/^\*\*\* Move to: (.+)$/m)?.[1]?.trim();
      const newPath = moveTo && moveTo.length > 0 ? moveTo : path;
      const oldHeader = action === "Add" ? "/dev/null" : `a/${path}`;
      const newHeader = action === "Delete" ? "/dev/null" : `b/${newPath}`;
      const diffBody = normalizePatchBody(action, body);
      return {
        path: newPath,
        diff: [`--- ${oldHeader}`, `+++ ${newHeader}`, diffBody]
          .filter((part) => part.length > 0)
          .join("\n"),
      };
    })
    .filter((file): file is PatchFile => file !== undefined);
}

export function patchSingleFilePath(input: string): string | undefined {
  const paths = new Set(patchFiles(input).map((file) => file.path));
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
// record (not nested in `event_msg`). The payload carries `replacement_history`
// (the messages folded into the summary) and sometimes `message`; observed real
// `message` values can be empty, so the canonical compact entry may have an
// empty summary while provenance stays preserved under source.raw.
// `event_msg.context_compacted` also fires as an empty notification marker — the
// adapter ignores it since the canonical content lives on the top-level record.
// Token counts (tokens_before / tokens_after) are not in the source stream; the
// optional payload fields stay absent unless a later session shape carries them.
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
  // Semantic finish time (ExecCommandEndEvent.completed_at_ms). The entry `ts`
  // stays the envelope arrival time for stream ordering; this surfaces the true
  // completion instant explicitly so duration/latency analysis never has to
  // infer it from `ts` deltas (duration is already in `data.duration_ms`).
  const completedAtMs = numericValue(payload.completed_at_ms);
  if (completedAtMs !== undefined) data.completed_at_ms = Math.trunc(completedAtMs);
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

// ── TurnContextItem policy capture (Codex protocol.rs TurnContextItem) ──
// Policy context is recorded once per real turn. The initial tuple is
// snapshotted into `header.meta["dev.codex.turn_context"]`; setting changes
// emit first-class mode/thinking events from overrides.ts.
// These pure helpers extract the shapes both call sites share.
const PERMISSION_FIELDS = [
  "approval_policy",
  "permission_profile",
  "active_permission_profile",
] as const;

const TURN_CONTEXT_POLICY_FIELDS = [
  ...PERMISSION_FIELDS,
  "sandbox_policy",
  "network",
  "file_system_sandbox_policy",
] as const;

const FLAVOR_FIELDS = ["personality", "collaboration_mode", "effort"] as const;

function pickPresent(p: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = p[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

// Full policy tuple for the header.meta snapshot, including the environment
// fields (current_date / timezone) that get no change events of their own.
export function turnContextSnapshot(p: Record<string, unknown>): Record<string, unknown> {
  return pickPresent(p, [
    ...TURN_CONTEXT_POLICY_FIELDS,
    ...FLAVOR_FIELDS,
    "current_date",
    "timezone",
  ]);
}

export function turnContextPermissionAxis(p: Record<string, unknown>): Record<string, unknown> {
  return pickPresent(p, PERMISSION_FIELDS);
}

export function turnContextExecutionAxis(p: Record<string, unknown>): Record<string, unknown> {
  return pickPresent(p, ["sandbox_policy", "network", "file_system_sandbox_policy"]);
}

export function turnContextFlavorAxis(p: Record<string, unknown>): Record<string, unknown> {
  return pickPresent(p, FLAVOR_FIELDS);
}

// Cross-adapter permission-mode label for `mode_change.payload.to_mode`:
// prefer the named preset (active_permission_profile / permission_profile), else
// the raw approval policy. Object policies (e.g. granular approval) canonicalize.
export function permissionModeLabel(p: Record<string, unknown>): string | undefined {
  const preset = stringValue(p.active_permission_profile) ?? stringValue(p.permission_profile);
  if (preset !== undefined) return preset;
  const approval = p.approval_policy;
  if (typeof approval === "string") return approval;
  if (approval !== undefined && approval !== null) return JSON.stringify(canonicalize(approval));
  return undefined;
}

// Recursively canonicalize a value to a key-order-independent form: objects
// become sorted [key, value] pairs at every depth, arrays keep order. Avoids
// false-positive change detection when a nested policy object (e.g. network
// `{allowed_domains, denied_domains}`) is serialized with a different key order.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, canonicalize(v)]);
  }
  return value;
}

// Deterministic key over an axis object for change detection, stable across key
// ordering at any nesting depth.
export function stableAxisKey(axis: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(axis));
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
// have no spec slot and are dropped (input+output remain recoverable). Codex
// `last_token_usage.input_tokens` also maps to `context_input_tokens`;
// `model_context_window`, when present, maps to `context_window_tokens`.
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
  if (inputDelta !== undefined) {
    merged.input_tokens = inputDelta;
    merged.context_input_tokens = inputDelta;
  }
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
  const contextWindow = numericValue(info.model_context_window);
  if (contextWindow !== undefined) merged.context_window_tokens = contextWindow;
  return mapAgentMessageUsage(merged);
}
