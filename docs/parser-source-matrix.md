# Parser Source Matrix

The living record of adapter source formats, verification dates, and fixture coverage. This document is the canonical source of truth for which source agents Agent Trail adapters cover, what was verified, when, and which committed fixtures lock that behavior.

See PRD [§7.2](./PRD.md) for the product specification of this matrix, and [`CONTEXT.md`](../CONTEXT.md) for the glossary entry. Modeled after [hwisu/opensession's parser-source-matrix.md](https://github.com/hwisu/opensession/blob/main/docs/parser-source-matrix.md).

## Status legend

- `pending verification` — adapter not yet implemented, or storage format not yet verified against the listed source-agent version.
- `verified` — adapter implemented, fixtures committed under `tests/fixtures/`, and behavior locked against the listed source-agent version on the listed verification date.
- `deprecated` — adapter or source format no longer covered. See notes for migration guidance.

An adapter is only considered supported once its row is `verified` with at least one committed synthetic fixture.

## Trail envelope emission (writer policy)

Spec §8.0 introduces an optional `type:"trail"` record at line 1 — the **trail envelope** — that carries file-level metadata (`producer`, `id`, `name`, file-scope `content_hash`, optional `sessions` manifest, vendor `meta`). It is distinct from the source-side "envelopes" that some source agents wrap around blocks of content (referenced by `source.raw.envelope` / `source.raw.envelope_ref`, spec §9.7).

Adapter writer policy:

- Adapters SHOULD emit a trail envelope by default. `producer` is the adapter package name and version (for example, `@agent-trail/adapters/claude-code/0.3.0`). The envelope `id` is a fresh file-level identifier (UUID/ULID), distinct from the source-session id surfaced on the session header.
- File-level `content_hash` is stamped after the session-level hash (spec §7.4 two-tier identity).
- Writers MAY skip envelope emission only when the caller explicitly opts out.

Adapter rows below reflect each adapter's current envelope-emission state once implemented; envelope-less output remains spec-compliant.

## Matrix

| Source agent | Source status | Storage format(s) | Reuse boundary | Reference URL | Verified on | Source-agent version | Observed entry types | Fixture names | Status |
|---|---|---|---|---|---|---|---|---|---|
| Pi | open | JSONL at `~/.pi/agent/sessions/<mangled-cwd>/<sessionId>.jsonl` | re-implement | https://github.com/earendil-works/pi (formerly badlogic/pi-mono) | 2026-05-21 | 3-synthetic | user_message, agent_message, tool_call, tool_result, branch_summary, agent_thinking, user_interrupt, context_compact, model_change, system_event | pi/linear-flow.jsonl; pi/branch-flow.jsonl; pi/reasoning-and-interrupt.jsonl; pi/compaction-and-model-change.jsonl | verified |
| Claude Code | closed | JSONL at `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl` | re-implement | https://docs.anthropic.com/claude-code | 2026-05-20 | 1.0.0-synthetic | user_message, agent_message, tool_call, tool_result, session_summary, agent_thinking, system_event, context_compact, user_interrupt, model_change | claude-code/basic-flow.jsonl; claude-code/fidelity-edge-cases.jsonl; claude-code/interrupt-and-model-change.jsonl | verified |
| Codex CLI | open | JSONL at `~/.codex/sessions/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl` (or `CODEX_HOME/sessions/`); single wrapped format (`session_meta` + `response_item` / `event_msg` / `turn_context` / `compacted`) | re-implement | https://github.com/openai/codex | 2026-05-28 | codex-tui 0.128.0 (also verified against Codex Desktop 0.133.0-alpha.1 and codex_sdk_ts 0.98.0) | user_message, agent_message, tool_call, tool_result, agent_thinking, context_compact, model_change, system_event | codex/desktop-tracer.jsonl; codex/reasoning-dedupe.jsonl; codex/compact-and-model-change.jsonl; codex/apply-patch.jsonl; codex/web-search.jsonl; codex/lifecycle.jsonl | verified |
| Cursor | closed | — | re-implement | — | — | — | — | — | pending verification |
| OpenCode | open | — | re-implement | — | — | — | — | — | pending verification |
| Aider | open | — | re-implement | — | — | — | — | — | pending verification |

Columns map directly to PRD §7.2. Cells use `—` when not yet determined. Source status (`open` / `closed`) reflects whether the source agent's session writer code is publicly available; it does not imply licensing of the trail format itself.

Pi fixture coverage currently includes the linear-flow scenario only: session header (integer
`version` stringified for `header.agent.version` and `header.source.format_version`), user message,
assistant `toolCall(read)` mapped to canonical `file_read`, `toolResult` paired via `toolCallId`,
and an assistant text message. Pi is tree-native (spec §12.1) so every entry emits `parent_id`
mirroring the source `parentId` chain. Tool-name mapping covers Pi's seven built-in tools (pi-mono
`coding-agent/src/core/tools/`): `read` / `write` / `bash` / `grep` / `find` map to canonical
`file_read` / `file_write` / `shell_command` / `file_search`. `ls` has no canonical kind, so we
synthesize a `shell_command` of the form `ls <path>` (original Pi args remain in `source.raw`).
`edit` has four observed Pi argument shapes:
(a) single-replace `{path, oldText, newText}` → `file_edit` with a one-hunk unified diff;
(b) `{path, edits: [{oldText, newText}, ...]}` (current pi-mono schema) → `file_edit` with a
multi-hunk diff;
(c) `{multi: [{path, oldText, newText}, ...]}` collapsing to a single file → `file_edit` with a
multi-hunk diff;
(d) `{multi: [...]}` spanning multiple files, or `{patch: "*** Begin Patch..."}` apply_patch
strings → `other`, since spec §10.1 `file_edit` is single-file unified-diff only.
Any other tool name (including MCP-extension tools real Pi sessions carry — `web_search`,
`fetch_content`, custom user tools) falls through to the `other` escape hatch per spec §10.5,
mirroring how Pi's own `/share` export-html renderer JSON-dumps unknown tools.

Tree and branch coverage (spec §12.1-12.3, §9.3): Pi is tree-native — every entry emits `parent_id`
mirroring the source `parentId` chain, including forks where multiple envelopes share one
`parentId`. Pi's native `branch_summary` envelopes (appended by Pi's `/tree` navigation; see
`packages/coding-agent/src/core/compaction/branch-summarization.ts` in
[`earendil-works/pi`](https://github.com/earendil-works/pi), formerly `badlogic/pi-mono`) map to
canonical `branch_summary` events. `payload.abandoned_branch_id` is resolved by walking the source
`fromId` chain up to the divergence point with the active branch (active leaf = last envelope in
source order per spec §12.2), then returning the entry id of the topmost source id on the abandoned
side (the "root of abandoned branch"). When the divergence walk lands on a source id the adapter
didn't emit an entry for (e.g. a `session_info` envelope that's currently dropped), the resolver
walks deeper into the abandoned subtree, then climbs the parent chain from `fromId` to the nearest
mapped ancestor; the verbatim source string is a last-resort fallback so the emitted payload remains
schema-valid. Pi-specific `details` (`readFiles`, `modifiedFiles`) are mirrored into
`metadata["dev.pi.branch_details"]` (reverse of `pi.dev`, the Pi product domain) per spec §11 in
addition to being preserved verbatim under `source.raw`.

Issue #20 expanded coverage to Pi's optional events. `agent_thinking` is emitted from assistant
`{type:"thinking", thinking, redacted?, thinkingSignature?}` content blocks (pi-ai
`packages/ai/src/types.ts` `ThinkingContent`); redacted blocks emit `payload.text =
"[redacted thinking]"`. `user_interrupt` is synthesized when assistant `message.stopReason ===
"aborted"` (pi-ai `StopReason`); Pi has no dedicated interrupt envelope, so the entry is stamped
`source.synthesized: true` with `payload.reason = "stop_reason_aborted"`. `context_compact` is
emitted from Pi's top-level `compaction` envelope (`summary`, `firstKeptEntryId`, `tokensBefore`,
optional `details` / `fromHook`); `payload.trigger` is always `"auto"` (Pi has no manual/auto
distinction in the envelope — `fromHook` distinguishes pi-core vs extension-fired compactions and
is preserved under `metadata["dev.pi.compaction"]`). `model_change` is emitted from Pi's top-level
`model_change` envelope (`provider`, `modelId`); `payload.from_model` is resolved from the last
assistant `message.model` (or earlier `model_change.modelId`) observed in source order.

Cross-cutting hardenings on the Pi adapter:
- Polymorphic timestamp parsing accepts ISO strings AND Unix ms numbers (or numeric strings) at
  the envelope boundary; canonical entry `ts` is always ISO. Pi top-level envelopes use ISO today,
  but pi-mono `messages.ts` carries `timestamp: number` (Unix ms) on internal `BashExecutionMessage`
  / `CompactionSummaryMessage` / `BranchSummaryMessage` shapes — defense-in-depth.
- Defensive bash arg shapes: `{cmd}`, `{command: string}`, and `{command: string[]}` (argv-style)
  all map to `shell_command`; argv entries with shell-special chars are quoted via the existing
  `quoteShellArg()` helper.
- Per-event `metadata["dev.pi.raw_type"]` audit tag stamps each entry with which source variant
  produced it (`assistant_text_block`, `assistant_thinking_block`,
  `assistant_redacted_thinking_block`, `assistant_toolcall_block`, `assistant_string_content`,
  `user_message_envelope`, `tool_result_envelope`, `branch_summary_envelope`,
  `compaction_envelope`, `model_change_envelope`, `aborted_assistant_synthetic`). Schema's
  `sourceMetadata` is `additionalProperties: false`, so the tag lives under reverse-DNS entry
  metadata per spec §11.
- Numeric tool-id coercion: pi-ai types `ToolCall.id` and `ToolResultMessage.toolCallId` as
  `string`, but a non-conforming source emitting a numeric id is coerced to a string at the adapter
  boundary so it never leaks into `semantic.call_id` / `tool_result.payload.for_id` as a number.

Issue #88 (`system_event.kind` standardization) added Pi `system_event` coverage. The adapter
distinguishes built-in pi-mono envelope types from the plugin extension surface (`custom`,
`custom_message`). Plugin-defined `customType` values are not enumerated by the adapter — the source
`customType` is preserved verbatim under `payload.data.custom_type` so consumers can disambiguate
without the adapter claiming to support every plugin shape.

Emitted Pi `system_event.kind` values (all vendor — `x-pi/*`):

- `x-pi/thinking_level_change` — pi-mono `thinking_level_change` envelope. `payload.data.thinking_level` carries `low | medium | high`. No reserved kind matches (model_change covers model id, not thinking level).
- `x-pi/session_info` — pi-mono `session_info` envelope (auto-named session summary from pi-mono's session-namer hook). `payload.data.name` carries the generated name.
- `x-pi/custom` — pi-mono `custom` envelope (plugin extension surface). Single bucket regardless of `customType`. Source `customType` and `data` are preserved under `payload.data.custom_type` and `payload.data.custom_data`.
- `x-pi/custom_message` — pi-mono `custom_message` envelope (plugin extension surface). Single bucket regardless of `customType`. Source `customType` is preserved under `payload.data.custom_type`; freeform `content` becomes `payload.text`.

Remaining deferred shapes: `bashExecution`, `label`, `parentSession` forked sessions.

Opt-in real-session test hook: `packages/adapters/src/pi/real-session.test.ts` reads
`AGENT_TRAIL_REAL_PI_SESSION` (absolute path to a real Pi JSONL session) and skips when unset.
Real sessions stay out of git per the fixture policy below.

Codex CLI fixture coverage (issue #32) targets the four mandated event kinds (`agent_thinking`,
`context_compact`, `model_change`, plus the baseline message + tool pair) and extends to lifecycle
and enrichment `system_event` records (`task_started`, `task_completed`, `x-codex/exec_command_end`,
`x-codex/patch_apply_end`, `x-codex/mcp_tool_call_end`, `x-codex/thread_goal_updated`,
`x-codex/web_search_end`), custom-channel tool calls (`apply_patch` single/multi-file dispatch,
`tool_search` round-trip), `web_search_call` mapping, argv-form shell argument quoting, and
spinner-glyph stripping. `user_interrupt` synthesis remains deferred — see the deferred-shapes
section below for why no real Codex session on the verifying contributor's machine emitted an
interrupt envelope. The storage layout deviates from the issue body's "mangled-cwd" assumption:
real Codex sessions live under a date-partitioned tree (`sessions/YYYY/MM/DD/rollout-*.jsonl`)
with no per-cwd subdir, so `detectSessions` walks the full tree and filters by the cwd recorded in
each file's header. The adapter `name` is `"codex"` (discovery handle); the trail header's
`agent.name` is `"codex-cli"` (the reserved schema agent name).

Format — single wrapped shape. The issue body's "Dual format dispatch (legacy CLI flat / desktop
wrapped)" turned out not to reflect reality: every real session on the verifying contributor's
machine, across three originator strings — `codex-tui` (interactive CLI, 0.128.x), `Codex Desktop`
(0.133.x-alpha), and `codex_sdk_ts` (SDK / older CLI, 0.98.x) — uses the same envelope shape, with
the first record always `{timestamp, type:"session_meta", payload:{id, timestamp, cwd, ...}}` and
subsequent records of the form `{timestamp, type, payload}`. The parser asserts a `session_meta`
first record and throws otherwise; the speculative flat-JSONL "legacy" branch was removed from
the verified slice rather than carrying dead code paired with a fictional fixture. If a real
flat-format session surfaces later, the dispatch can be reintroduced under a later hardening pass.

Observed top-level `type` values: `session_meta`, `response_item`, `event_msg`, `turn_context`,
`compacted`. Entry-type mapping:

- `event_msg.payload.type == "user_message"` → `user_message`. Text comes from `payload.message`.
  Preferred over `response_item.payload.type == "message"` (role:"user") because the
  response-item channel also carries synthetic `role:"developer"` AGENTS.md preambles which
  should not surface as user input — a real `codex-tui` session under this repo emitted exactly
  one `event_msg.user_message` for the live prompt and two `response_item.message` records
  (preamble + duplicate of the prompt). Cross-channel dedupe (folding `response_item.message`
  back in when no event_msg surface fires) remains a deferred hardening.
- `event_msg.payload.type == "agent_message"` → `agent_message`. Text from `payload.message`.
  Same channel choice; the `response_item.message` (role:"assistant") channel echoes the same
  content one record later.
- `response_item.payload.type == "function_call"` → `tool_call`. Canonical tool-kind dispatch:
  - `exec_command` (the canonical interactive-shell tool in real Codex rollouts) with
    `arguments` JSON carrying `cmd` plus optional `workdir`, and the forward-compat permission /
    timing fields (`yield_time_ms`, `max_output_tokens`, `justification`,
    `sandbox_permissions`, `prefix_rule`, `login`, `tty`) → `shell_command` with
    `args.command` and `args.cwd` populated from `workdir`. Extras are ignored.
  - `shell` / `container.exec` (defensive fallbacks for older session shapes) → same
    `shell_command` mapping.
  - Shell arguments accept three shapes: `{cmd: "..."}`, `{command: "..."}`, and
    `{command: ["bash", "-lc", "..."]}` argv-form. Argv-form joins with POSIX-safe quoting
    (same helper Pi uses) so the canonical `args.command` is always a single string.
  - `read` with `{path}` → `file_read`.
  - Anything else → `other` with `args = {name, args:{...}}`. Vendor tool names are passed
    through unchanged; `tools.<name>` prefix is stripped per spec convention (defensive — no
    real session observed with the prefix on this machine).
- `response_item.payload.type == "function_call_output"` → `tool_result` paired via `call_id` →
  emitted `tool_call.id` (also surfaced under `semantic.call_id` on both records). `output` is
  spinner-strip cleaned: trailing TUI decorations (a `\n` followed by `·` and a space) are
  removed when the trim region contains an unambiguous spinner glyph (`·`, `•`); natural
  trailing whitespace such as a shell command's `\n` is preserved.
- `response_item.payload.type == "custom_tool_call"` → `tool_call`. The request carries a raw
  string `input` (not a JSON `arguments` string). Dispatch:
  - name `apply_patch` with a single-file patch (exactly one `*** Update File:` /
    `*** Add File:` / `*** Delete File:` marker) → `file_edit{path, diff}`; `diff` is the full
    patch text.
  - name `apply_patch` with a multi-file patch → `other{name:"apply_patch", args:{input}}`
    (spec §10.1 makes `file_edit` single-file unified-diff only).
  - Any other custom tool name → `other{name:<canonical>, args:{input}}` (canonical strips a
    `tools.` prefix if present).
- `response_item.payload.type == "custom_tool_call_output"` → `tool_result` paired via
  `call_id`, same spinner-strip applied.
- `response_item.payload.type == "web_search_call"` → `tool_call`. `action.type == "search"`
  with a `queries[0]` or `query` string → `tool_call{tool:"web_search", args:{query}}`.
  Anything else (no URL recoverable for `web_fetch`) falls through to `other`.
- `response_item.payload.type == "tool_search_call"` / `tool_search_output` →
  `tool_call{tool:"other", args:{name:"tool_search", args:{query, limit}}}` + paired
  `tool_result`. Output is the JSON-stringified `tools` array.
- `response_item.payload.type == "reasoning"` — Codex stores reasoning twice: an opaque
  `encrypted_content` blob (still ignored; no plaintext recoverable) and an optional
  plaintext `summary[]` array. When summary items carry `text`, they emit a deduped
  `agent_thinking` with `metadata["dev.codex.raw_type"] = "response_item.reasoning.summary"`.
- `event_msg.payload.type == "agent_reasoning"` and `event_msg.payload.type ==
  "agent_reasoning_raw_content"` both → `agent_thinking`. Within a turn
  (`turn_context.payload.turn_id`), normalised-text duplicates collapse to a single entry;
  origin is recorded under `metadata["dev.codex.raw_type"]` (schema's `sourceMetadata` is
  `additionalProperties: false`, so the audit tag lives under reverse-DNS entry metadata per
  spec §11 — same precedent as Pi). The dedupe pool now covers the response-item summary path
  too.
- Top-level `compacted` record → `context_compact`. The summary text lives at `payload.message`
  (real shape — not `payload.summary`), with `payload.replacement_history` carrying the folded
  message list (preserved verbatim under `source.raw` via the source slot). `event_msg.payload
  .type == "context_compacted"` is an empty notification marker that fires alongside; the
  adapter ignores it since the canonical content lives on the top-level record.
  `payload.trigger` is hard-coded to `"auto"` (Codex auto-compaction has no manual signal).
  `tokens_before` / `tokens_after` are emitted only when the source happens to carry them.
- In-session model switch: synthesized `model_change` is emitted when consecutive
  `turn_context.payload.model` values differ. `payload.from_model` is the last observed model;
  `payload.to_model` is the new value. `source.synthesized: true` and
  `metadata["dev.codex.raw_type"] = "turn_context.model_change"` flag the synthetic origin.

Lifecycle-vocabulary `system_event` emissions:

- `event_msg.task_started` → `system_event{kind:"task_started"}` (reserved §9.3). `data`
  carries `turn_id`, `started_at`, `model_context_window`, `collaboration_mode_kind` when
  present.
- `event_msg.task_complete` (singular in the source — `task_completed` is the canonical
  schema kind) → `system_event{kind:"task_completed"}`. `data` carries `turn_id`,
  `completed_at`, `duration_ms`, `time_to_first_token_ms`, `last_agent_message`. The source
  wording is preserved under `metadata["dev.codex.raw_type"] = "event_msg.task_complete"`.
- `event_msg.exec_command_end` → `system_event{kind:"x-codex/exec_command_end"}` with
  `semantic.call_id` linking to the originating `exec_command` tool_call. `data` carries
  `turn_id`, `command`, `cwd`, `exit_code`, `duration_ms`, truncated `stdout_excerpt` /
  `stderr_excerpt` (capped to ~2KB per side), `status`, and the parsed-command structure.
- `event_msg.patch_apply_end` → `system_event{kind:"x-codex/patch_apply_end"}` with
  `semantic.call_id` linking to the originating `apply_patch` tool_call. `data` carries
  `success`, `changes`, `stdout_excerpt`, `stderr_excerpt`, `status`.
- `event_msg.mcp_tool_call_end` → `system_event{kind:"x-codex/mcp_tool_call_end"}` with
  `semantic.call_id`. `data` carries `plugin_id`, `invocation`, `duration_ms`, and a
  flattened `result_ok` boolean derived from the Rust-style `{Ok|Err: …}` enum.
- `event_msg.web_search_end` → `system_event{kind:"x-codex/web_search_end"}`. Pairing is
  query-based: consumers join by matching `data.query` against the `web_search` tool_call's
  `args.query`. The source `ws_*` vendor id is preserved verbatim under `data.call_id` for
  audit fidelity, but is not surfaced as `semantic.call_id` because no `tool_call` was
  registered against it (`web_search_call` carries no `call_id` in the response_item channel).
- `event_msg.thread_goal_updated` → `system_event{kind:"x-codex/thread_goal_updated"}`.
  `data` carries `thread_id`, `turn_id`, `goal`.

`dev.codex.raw_type` audit-tag values stamped by the adapter:

- `event_msg.user_message` — live user input.
- `event_msg.agent_message` — agent reply text.
- `response_item.function_call` — tool call request via the canonical channel.
- `response_item.function_call_output` — tool call output via the canonical channel.
- `response_item.custom_tool_call` — `apply_patch` and other custom-channel tool calls.
- `response_item.custom_tool_call_output` — paired output.
- `response_item.web_search_call` — web search request.
- `response_item.tool_search_call` / `tool_search_output` — tool discovery round-trip.
- `event_msg.agent_reasoning` — synthesized reasoning surface.
- `event_msg.agent_reasoning_raw_content` — raw reasoning surface.
- `response_item.reasoning.summary` — plaintext reasoning from the response-item channel.
- `compacted` — auto-compaction (top-level record).
- `turn_context.model_change` — synthesized model-change marker.
- `event_msg.task_started` / `event_msg.task_complete` — lifecycle bookends.
- `event_msg.exec_command_end` / `event_msg.patch_apply_end` /
  `event_msg.mcp_tool_call_end` / `event_msg.web_search_end` — paired enrichment events.
- `event_msg.thread_goal_updated` — goal change marker.

Deferred shapes (hardening follow-ups beyond the current verified slice):

- `user_interrupt` / `event_msg.turn_aborted` — no real interrupt signal observed in any
  session on the verifying contributor's machine across `codex-tui` 0.128.x, `Codex Desktop`
  0.133.x-alpha, and `codex_sdk_ts` 0.98.x (the full corpus was scanned, including a 2320-line
  Codex Desktop session). Acceptance criterion's matrix-absence path applies; no fixture
  committed. The mapping lands when a real signal surfaces, with the fixture derived from the
  real record shape (synthetic ids only).
- `event_msg.token_count` → `agent_message.payload.usage` (`agentMessageUsage` rollup) —
  needs a cross-record correlation pass so token counts attach to the agent_message they
  belong to, rather than orphaning as a standalone event. Tracked separately.
- Cross-channel dedupe between `event_msg.user_message` / `event_msg.agent_message` and the
  `response_item.message` channel (the adapter currently picks event_msg only). Folding
  response_item.message back in when no event_msg surface fires would cover legacy / partial
  sessions.
- Encrypted reasoning recovery — `response_item.reasoning` with `encrypted_content` carries
  no plaintext and stays skipped until a key surfaces.
- Subagent header `fork_from` lineage via `agent_role` / `source.subagent.parent_thread_id`
  — no such field observed in any real session yet; defer until evidence.
- `~/.codex/config.toml` profile reading for model identity — `turn_context.payload.model`
  is already canonical; profile file is redundant noise unless future sessions diverge.
- 12s `event_msg` ↔ `response_fallback` dedupe — no `response_fallback` records observed in
  the corpus; defer until evidence.
- `request_user_input` Q&A reconstruction — no `request_user_input` records observed in the
  corpus; defer until evidence.

Opt-in real-session test hook: `packages/adapters/src/codex/real-session.test.ts` reads
`AGENT_TRAIL_REAL_CODEX_SESSION` (absolute path to a real Codex JSONL session) and skips when
unset. Real sessions stay out of git per the fixture policy below.

Claude Code fixture coverage currently includes mixed assistant content blocks, multiple tool calls,
multiple tool results, tool-result error state, user text blocks, thinking/redacted-thinking blocks,
real summary and compact-summary records, meaningful system/progress/queue records, user interrupt
markers (both `[Request interrupted by user]` and `[Request interrupted by user for tool use]`
variants observed in real sessions), and in-session model switches (emitted as synthetic
`model_change` entries with `source.synthesized: true` when assistant `message.model` shifts).
Deferred shapes include image attachments, server-tool result blocks, cross-file subagent merging,
and overflow blob storage.

Emitted `system_event.kind` values (spec §9.3):

Reserved lifecycle vocabulary (cross-agent portable):

- `session_start` — `progress` envelope with `data.hookEvent == "SessionStart"`, plus continuation-preamble user messages.
- `session_end` — `progress` envelope with `data.hookEvent == "SessionEnd"`.
- `turn_end` — `progress` envelope with `data.hookEvent == "Stop"`, plus `system` envelope with `subtype == "stop_hook_summary"`.
- `subagent_end` — `progress` envelope with `data.hookEvent == "SubagentStop"`.
- `pre_tool_use` — `progress` envelope with `data.hookEvent == "PreToolUse"`.
- `post_tool_use` — `progress` envelope with `data.hookEvent == "PostToolUse"`.
- `permission_request` — `progress` envelope with `data.hookEvent == "Notification"`.
- `hook_fired` — `progress` envelope with `data.type == "hook_progress"` and an unrecognized `hookEvent` (forward-compatibility fallback).
- `queue_operation` — `queue-operation` envelope. id synthesized (`source.synthesized: true`) because the source records lack `uuid`.
- `permission_mode_change` — `permission-mode` envelope. Both id and timestamp synthesized (`source.synthesized: true`): id is a fresh UUID, timestamp inherited from the most recent prior envelope. `data.to` carries the new mode (e.g., `plan`, `bypassPermissions`); `data.from` carries the previous mode when a prior mode is known.

Vendor extensions (Claude Code-specific):

- `x-claudecode/turn_duration` — `system` envelope with `subtype == "turn_duration"` (duration metadata for the just-completed turn; `turn_end` is preferred for boundary semantics).
- `x-claudecode/api_error` — `system` envelope with `subtype == "api_error"`.
- `x-claudecode/away_summary` — `system` envelope with `subtype == "away_summary"` (Claude Code "you were away" recap).
- `x-claudecode/local_command` — `system` envelope with `subtype == "local_command"` (slash-command stdout).
- `x-claudecode/bridge_status` — `system` envelope with `subtype == "bridge_status"` (remote-control bridge).
- `x-claudecode/compact_boundary` — `system` envelope with `subtype == "compact_boundary"` (compaction metadata; the canonical `context_compact` entry is produced from the summary envelope).
- `x-claudecode/<subtype>` — fallback for unknown safe-named `system` subtypes.
- `x-claudecode/system` — fallback for `system` envelopes without a recognizable subtype.
- `x-claudecode/progress` — fallback for `progress` envelopes whose `data.type` is not `hook_progress`.
- `x-claudecode/pr_link` — `pr-link` envelope. id synthesized (`source.synthesized: true`).

Vendor kinds are not portable across agents. Promote to the reserved enum (with a minor spec version bump) if another adapter ends up emitting the same shape.

Header / envelope enrichment from non-timeline envelopes:

- `ai-title` and `agent-name` envelopes are NOT in `isTracerEnvelope` (they don't belong on the timeline). The parser extracts them and surfaces:
  - `envelope.name` ← first non-empty of `aiTitle`, `agentName`.
  - `envelope.meta["x-claudecode/ai_title"]` / `envelope.meta["x-claudecode/agent_name"]` preserve both raw values for traceability.
- `worktree-state` envelopes are NOT in `isTracerEnvelope`. The parser extracts them and surfaces under `header.vcs`:
  - `vcs.branch` ← `worktreeSession.worktreeBranch` (overrides the live `git symbolic-ref` value, which may differ).
  - `vcs.worktree` ← `{ name, path, original_cwd?, original_branch?, original_head_commit? }`.
  - When the live working tree is unreadable (e.g., paseo-style ephemeral worktrees), `vcs.revision` and `vcs.head_commit` fall back to `originalHeadCommit` from the envelope.

## Fixture policy

Agent Trail adapter work distinguishes two kinds of fixtures:

1. **Committed fixtures** must be synthetic or redacted. They live under `tests/fixtures/` and are reviewed in PRs. No real session content, no PII, no secrets, no API keys, no real user identifiers, no real file paths from contributors' machines. See [`tests/fixtures/validation/README.md`](../tests/fixtures/validation/README.md) for the canonical example: synthetic ids, synthetic agent names, synthetic timestamps, one scenario per file, documented expected diagnostics.

2. **Real local sessions** stay out of git. Adapters may include opt-in ignored tests that load a path from an environment variable (e.g. `AGENT_TRAIL_REAL_CLAUDE_CODE_DIR`) and skip when unset. These tests run on the contributor's machine, never in CI, and never check fixture data into the repo.

An adapter PR is not eligible to move its matrix row from `pending verification` to `verified` until:

- At least one committed synthetic fixture exercises the adapter's main entry types.
- The verification date and source-agent version are filled in.
- Observed entry types and fixture names columns reflect the committed fixtures.

If real-session debugging produces a fixture worth committing, redact it (strip PII, replace ids with synthetic ones, normalize timestamps) and add it under `tests/fixtures/`. The redacted fixture, not the raw session, is what locks behavior.

## Update procedure

When an adapter author verifies behavior against a new source-agent version:

1. Run the adapter's fixture tests against the new source-agent release.
2. Update the row's `Verified on`, `Source-agent version`, `Observed entry types`, and `Fixture names` columns.
3. If new entry types appeared, add a fixture under `tests/fixtures/` covering each, and reference it in the matrix.
4. If existing entry types changed shape, treat as a breaking source-format change: note it in the row, add a fixture for the new shape, keep the prior fixture if older versions remain supported.
5. Flip status to `verified` once all of the above are in the PR.

A row going stale (no re-verification against a current source-agent release) does not automatically downgrade, but adapter authors should re-verify on a cadence proportional to the source agent's release velocity.
