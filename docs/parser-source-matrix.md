# Parser Source Matrix

The living record of adapter source formats, verification dates, and fixture coverage. This document is the canonical source of truth for which source agents Agent Trail adapters cover, what was verified, when, and which committed adapter fixtures or fixture-building tests lock that behavior.

See PRD [§7.2](./PRD.md) for the product specification of this matrix, and [`CONTEXT.md`](../CONTEXT.md) for the glossary entry. Modeled after [hwisu/opensession's parser-source-matrix.md](https://github.com/hwisu/opensession/blob/main/docs/parser-source-matrix.md).

## Status legend

- `pending verification` — adapter not yet implemented, or storage format not yet verified against the listed source-agent version.
- `verified` — adapter implemented, fixtures committed under `packages/adapters/tests/fixtures/` or fixture-building adapter tests committed under `packages/adapters/src/`, and behavior locked against the listed source-agent version on the listed verification date.
- `deprecated` — adapter or source format no longer covered. See notes for migration guidance.

An adapter is only considered supported once its row is `verified` with at least one committed synthetic fixture or committed synthetic fixture-building test.

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
| Pi | open | JSONL at `~/.pi/agent/sessions/<mangled-cwd>/<sessionId>.jsonl` | re-implement | https://github.com/earendil-works/pi (formerly badlogic/pi-mono) | 2026-06-02 | 3-synthetic | user_message, agent_message, tool_call, tool_result, tool_call_aborted, branch_summary, agent_thinking, user_interrupt, context_compact, model_change, thinking_level_change, session_terminated, system_event, session_metadata_update | pi/linear-flow.jsonl; pi/branch-flow.jsonl; pi/reasoning-and-interrupt.jsonl; pi/compaction-and-model-change.jsonl; pi/usage-and-cost.jsonl; pi/system-events.jsonl; pi/tool-result-error.jsonl; pi/quarantine.jsonl; pi/leaf-and-label.jsonl; pi/bash-execution.jsonl; pi/custom-message-variants.jsonl | verified |
| Claude Code | closed | JSONL at `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl` | re-implement | https://docs.anthropic.com/claude-code | 2026-06-02 | 1.0.0-synthetic | user_message, agent_message, tool_call, tool_result, tool_call_aborted, user_query, user_query_response, session_summary, agent_thinking, system_event, context_compact, user_interrupt, model_change, mode_change, capability_change, session_metadata_update | claude-code/basic-flow.jsonl; claude-code/fidelity-edge-cases.jsonl; claude-code/compact-provenance.jsonl; claude-code/interrupt-and-model-change.jsonl; claude-code/permission-mode.jsonl; claude-code/capability-changes.jsonl | verified |
| Codex CLI | open | JSONL at `~/.codex/sessions/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl` (or `CODEX_HOME/sessions/`), plus `session_index.jsonl` sidecar names; single wrapped format (`session_meta` + `response_item` / `event_msg` / `turn_context` / `compacted`) | re-implement | https://github.com/openai/codex | 2026-06-02 | codex-tui 0.128.0 + 0.135.x (also Codex Desktop 0.133.0-alpha.1, codex_sdk_ts 0.98.0) | user_message, agent_message, tool_call, tool_result, user_query, user_query_response, agent_thinking, context_compact, model_change, mode_change, thinking_level_change, user_interrupt, system_event, capability_change, session_metadata_update | codex/desktop-tracer.jsonl; codex/reasoning-dedupe.jsonl; codex/compact-and-model-change.jsonl; codex/apply-patch.jsonl; codex/web-search.jsonl; codex/lifecycle.jsonl; codex/token-usage.jsonl; codex/reasoning-cross-turn.jsonl; codex/v0_135-events.jsonl; codex/image-message.jsonl; codex/capability-changes.jsonl; codex/capability-changes-v0_128.jsonl | verified |
| Cursor | closed | — | re-implement | — | — | — | — | — | pending verification |
| OpenCode | open | SQLite `opencode.db` plus file storage under `~/.local/share/opencode/storage/{session,message,part,todo}`; `OPENCODE_DATA_DIR` / `OPENCODE_DB` overrides | re-implement | https://github.com/sst/opencode | 2026-06-04 | 1.0.153 local + synthetic v1 | user_message, agent_message, tool_call, tool_result, tool_call_aborted, agent_thinking, context_compact, model_change, task_plan_update, session_terminated, system_event, session_metadata_update | opencode/index.test.ts synthetic file-storage, SQLite, hybrid, lifecycle, quarantine fixtures; optional real JSON + SQLite smoke tests | verified |
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
`LeafEntry` (active branch-tip) maps to `system_event{kind:"x-pi/leaf_change"}` and `LabelEntry`
to `system_event{kind:"x-pi/label"}`, both with the raw Pi `targetId` resolved to the referenced
trail entry id (nearest mapped ancestor when the target itself emitted nothing). The most recent
`x-pi/leaf_change` at or before a `branch_summary` (its contemporaneous active tip, not a
file-global final leaf) feeds that summary's divergence resolution; a cleared tip resets it so the
summary falls back to its own parent. `BashExecutionMessage` (user `!`/`!!` shell prefix)
maps to a `shell_command` `tool_call` plus either a `tool_result` or, when
`bashExecution.cancelled === true`, `tool_call_aborted{scope:"tool_call", reason:"user_interrupt"}`.
Exit/truncate/full-output-path metadata stays under `dev.pi.*` meta. The message-channel variants
(`message.role` of `bashExecution` / `custom` / `branchSummary` / `compactionSummary`) route to the
same trail entries as their tree-entry counterparts.

**Adapter-kit implementation (#146 Phase 4).** All three adapters are built on the adapter-kit
mapping DSL + two-pass reconciler (`defineAdapter`). Each agent's production `TrailAdapter`
(`<agent>Adapter` in `<agent>/index.ts`) keeps the discovery/header/VCS/envelope glue and delegates
entry production to its kit engine (`<agent>/kit.ts` + `mappings.ts` + `reconcile-rules.ts`,
Codex also `overrides.ts`). The earlier hand-written parsers were removed once parity held; only the
shared helpers they exported (`buildHeader`, `source.ts`/`tools.ts`/`entry-metadata.ts` helpers,
Codex's tool/usage helpers, Pi's `divergence.ts`) remain.

- **Pi** — tree-native: 16 pure mappings (**override-ratio 0**) plus four custom reconciler rules for
  tree parenting + `branch_summary` divergence, tool-kind propagation, `model_change.from_model`
  threading, and EOF `session_terminated` synthesis (the kit's general `branchReconciliation` is
  deferred — Pi carries its own rule). Pi `/tree` branches remain inside one session group via
  `parent_id`; only Pi `parentSession` forked sessions, if added later, become separate child
  session groups.
- **Codex** — linear (`parentChain`), explicit `call_id`s (`toolLinking`), no per-entry
  `source.schema_version` → static mappings. Stateful behaviors split per the kit's grain:
  **pass-1 overrides** for synthesized `model_change` + per-turn reasoning dedup (reset on `turn_id`),
  and a **custom reconciler rule** for the `token_count` → preceding-`agent_message` usage rollup.
  The emitted `source.agent` is `codex-cli` while the schema registers under `codex`, so
  `AdapterDef.schemaAgent` separates the schema-registry key from the emitted `AgentName`.
  Two source-schema versions: `codex/v0.128` (`>=0.128.0 <0.129.0`) and `codex/v0.135` (`>=0.129.0`,
  a superset adding the subtypes 0.135 introduced). The 0.135 additions are handled as:
  `event_msg.turn_aborted` → `user_interrupt` because the verified source evidence is turn-level,
  not call-level; `event_msg.item_completed` (wraps the agent's `Plan`)
  → `system_event` preserving the item (a dedicated task-plan event is **#131**);
  `event_msg.context_compacted` is **recognized but intentionally suppressed** (duplicate of the
  top-level `compacted` record). `response_item.message` is text-only-suppressed (its text duplicates
  the `event_msg` echo) **except** when it carries `input_image` content: those images map to the
  spec `attachments[]` field and are folded onto the matching `user_message`/`agent_message` by a
  transient-carrier reconciler (`codexImageRollup`), so codex user images are captured without
  duplicating the message (#114 attachments). `spawn_agent` maps to `subagent_invoke`; when the
  paired spawn output exposes an `agent_id` and exactly one direct child rollout file has
  `session_meta.payload.id` equal to that `agent_id`, the adapter emits the child as a separate
  session group with `header.fork_from` pointing at the parent tool call and backfills the parent
  `subagent_invoke.args.session_id` with the child header `id`. `wait_agent` and `close_agent`
  remain ordinary tool events unless the source carries enough lifecycle evidence to say more.
- **Claude Code** — linear (`parentChain`); every record carries `version` → per-record
  `source.schema_version`, static mappings; `agent` == schema key `claude-code`. Eleven pure mappings
  (user/assistant multi-block fanout, summary→session_summary/context_compact,
  ai-title/agent-name/worktree-state→session_metadata_update,
  system/progress/queue-operation/pr-link→system_event, permission-mode→mode_change) plus custom rules for
  synthesized `model_change`, `mode_change` deltas, compact-boundary provenance,
  TodoWrite task-plan delta/ack handling, tool-kind propagation to results, and multi-block
  `source.raw.envelope_ref` backfill + hint stripping. Override-ratio 0. `Agent` /
  `Task` calls map to `subagent_invoke`; direct child files under
  `<parentSessionId>/subagents/*.jsonl` are bundled as separate session groups only when exactly one
  child first-user prompt matches the parent task text. Child group ids are deterministic, derived
  from the parent session id plus child `agentId` or filename stem; sidechain child messages, tool
  calls, and tool results remain in the child group transcript.
  `permission-mode` envelopes emit first-class `mode_change{scope:"permission"}` entries. Both id
  and timestamp are synthesized (`source.synthesized: true`): id is deterministically derived and
  stable across re-parses, timestamp inherits from the most recent prior envelope. `payload.to_mode`
  carries the new mode (for example, `plan` or `bypassPermissions`); `payload.from_mode` carries the
  previous mode when known.

Entry ids, `parent_id`, `payload.for_id`/`abandoned_branch_id`/`open_call_ids`, `semantic.call_id`,
and `source.raw.envelope_ref` are derived by the kit engine and are not byte-identical to the old
hand-written parsers (that's expected — no stored trails depend on them). Accepted behaviors of the
kit path:

- A schema-invalid record with a missing or unparseable timestamp quarantines with the nearest
  writer-strict source timestamp inherited by the kit, keeping the diagnostic entry schema-valid.
- **`parent_id` topology varies by adapter reconciler config.** Pi is tree-native (`piParentResolution`
  rebuilds the real `parentUuid` tree). Claude Code runs the kit's `parentChain: true`, which emits an
  explicit **sequential** chain — each entry parents off the entry emitted immediately before it, and
  roots carry a `null` `parent_id` (the prior hand-written parser emitted no `parent_id` for linear
  Claude Code sessions). Codex runs `parentChain: false` and emits **no** `parent_id`, matching its
  prior parser. All three are schema-valid (`parent_id` is optional and nullable).

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
Pi has no observed mid-session registry delta primitive; extension-like tool calls remain
`tool_call.tool="other"` and do not synthesize `capability_change` events.

Tree and branch coverage (spec §12.1-12.3, §9.3): Pi is tree-native — every entry emits `parent_id`
mirroring the source `parentId` chain, including forks where multiple envelopes share one
`parentId`. Pi's native `branch_summary` envelopes (appended by Pi's `/tree` navigation; see
`packages/coding-agent/src/core/compaction/branch-summarization.ts` in
[`earendil-works/pi`](https://github.com/earendil-works/pi), formerly `badlogic/pi-mono`) map to
canonical `branch_summary` events. `payload.abandoned_branch_id` is resolved by walking the source
`fromId` chain up to the divergence point with the active branch (active leaf = last envelope in
source order per spec §12.2), then returning the entry id of the topmost source id on the abandoned
side (the "root of abandoned branch"). When the divergence walk lands on a source id the adapter
didn't emit an entry for (for example, a non-timeline envelope without a mapped entry), the resolver
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
optional `details` / `fromHook`); when `firstKeptEntryId` resolves, emitted entries before that
source id populate `payload.replaced_message_ids`. `payload.trigger` is always `"auto"` (Pi has no
manual/auto distinction in the envelope — `fromHook` distinguishes pi-core vs extension-fired
compactions and is preserved under `metadata["dev.pi.compaction"]`). `model_change` is emitted from Pi's top-level
`model_change` envelope (`provider`, `modelId`); `payload.from_model` is resolved from the last
assistant `message.model` (or earlier `model_change.modelId`) observed in source order.

Pi usage telemetry: assistant `message.usage` maps `input` → `input_tokens`, `output` →
`output_tokens`, `cacheRead` → `cache_read_tokens`, `cacheWrite` → `cache_creation_tokens`, and
`context_input_tokens = input + cacheRead + cacheWrite`. `totalTokens` is intentionally not mapped to
`context_input_tokens` because it includes output tokens; `cost` remains source-only under
`source.raw`. Tool-result `message.details.toolMetadata.contextAtCompletion` is preserved exactly at
`meta["dev.pi.context_at_completion"]` and is not promoted to assistant `context_window_tokens`.

Pi carries no session-time VCS signal. The adapter leaves `header.vcs` undefined instead of reading
live git state from `header.cwd`, because parse-time `cwd` may be stale or reused by another
repository.

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

Pi `session_info` now maps to `session_metadata_update{field:"name", reason:"ai_generated"}`
instead of a vendor `system_event`.

Pi `thinking_level_change` now maps to first-class `thinking_level_change` with
`payload.to_level` from `thinkingLevel`.

Emitted Pi `system_event.kind` values (all vendor — `x-pi/*`):

- `x-pi/custom` — pi-mono `custom` envelope (plugin extension surface). Single bucket regardless of `customType`. Source `customType` and `data` are preserved under `payload.data.custom_type` and `payload.data.custom_data`.
- `x-pi/custom_message` — pi-mono `custom_message` envelope (plugin extension surface). Single bucket regardless of `customType`. Source `customType` is preserved under `payload.data.custom_type`; freeform `content` becomes `payload.text`. `display` surfaces as `meta["dev.pi.display"]` (display:false events are kept, not dropped).
- `x-pi/interactive_shell_transfer` — pi-mono `custom_message.customType == "interactive-shell-transfer"`. This is an external interactive-shell lifecycle record, not a linkable `tool_call`; the adapter keeps it as a vendor `system_event` and preserves `session_id`, `duration`, `exit_code`, `timed_out`, `cancelled`, and output truncation counts under `payload.data`.
- `x-pi/leaf_change` — pi-mono `leaf` envelope (active branch-tip pointer). `payload.data.leaf_id` carries the referenced trail entry id; a null `targetId` clears the pointer (no `data`).
- `x-pi/label` — pi-mono `label` envelope (targetId+label annotation). `payload.data.target_id` carries the referenced trail entry id; `payload.data.label` preserves the source label when present.

Remaining deferred shapes: `parentSession` forked sessions. If Pi
`parentSession` support is added, those forked sessions should use child session groups with
`header.fork_from`; Pi `/tree` branches stay inside one tree-native group.

Opt-in real-session test hook: `packages/adapters/src/pi/real-session.test.ts` reads
`AGENT_TRAIL_REAL_PI_SESSION` (absolute path to a real Pi JSONL session) and skips when unset.
Real sessions stay out of git per the fixture policy below.

OpenCode fixture coverage (issue #34) covers both storage backends. File storage is read from
`storage/session`, `storage/message`, `storage/part`, and `storage/todo`; SQLite sessions are read
from `opencode.db` with virtual refs of the form `opencode.db#<session-id>`. Discovery prefers file
storage when both backends contain the same session id, but file-backed parsing opportunistically
enriches the trail with matching SQLite session/project metadata when the DB is present. That keeps
the file transcript authoritative while capturing DB-only session metadata such as upstream
OpenCode version, default model, share URL, token totals, summary diff metadata, revert/permission
state, project worktree, and session state. If the DB is absent, the same file session still parses
and validates with the metadata available in file storage.

OpenCode source schema `v1` validates the adapter's normalized records, not a single upstream file
format. Known normalized record types are `session`, `project`, `message`, `part`, `todo`,
`session_message`, `permission`, and `event`. Known upstream part types are `text`, `reasoning`, `file`, `tool`,
`step-start`, `step-finish`, `snapshot`, `patch`, `agent`, `retry`, `compaction`, and `subtask`.
Unknown top-level or part types quarantine as `system_event{kind:"x-opencode/unknown_record"}` with
lossless redacted `source.raw`; every emitted entry carries `meta["dev.opencode.raw_type"]`.

OpenCode mappings: text parts map to user/agent messages; reasoning maps to `agent_thinking`
(encrypted-only reasoning emits `[encrypted reasoning]`); compaction maps to `context_compact`;
model changes map to `model_change`; `todowrite` with todos maps to `task_plan_update`; incomplete
open tool calls terminate at EOF with `session_terminated`. File parts fold into message
`attachments[]` when paired with user/assistant text. Patch, snapshot, agent, retry, permission,
diagnostic, and weaker-fit session/project surfaces emit stable `x-opencode/*` vendor
`system_event`s while preserving raw source. Built-in tools map to canonical tool kinds where fit is
strong (`file_read`, `file_write`, `file_edit`, `shell_command`, `shell_output`, `file_search`,
`web_fetch`, `subagent_invoke`, `mcp_call`, or `other`).

Opt-in real-session test hooks:
`packages/adapters/src/opencode/real-session.test.ts` reads `AGENT_TRAIL_REAL_OPENCODE_ROOT`
(OpenCode data root, storage root, or `ses_*.json`) for file-backed smoke, and
`AGENT_TRAIL_REAL_OPENCODE_DB_SESSION` (`opencode.db`, `opencode.db#<session-id>`, or OpenCode data
root) for SQLite-backed smoke. Both skip when unset/default storage is unavailable and only assert
optional-field correctness when those features are present. Real sessions stay out of git per the
fixture policy below.

Codex CLI fixture coverage (issue #32) targets the four mandated event kinds (`agent_thinking`,
`context_compact`, `model_change`, plus the baseline message + tool pair) and extends to lifecycle
and enrichment `system_event` records (`task_started`, `task_completed`, `x-codex/exec_command_end`,
`x-codex/patch_apply_end`, `x-codex/mcp_tool_call_end`, `x-codex/web_search_end`),
with unit-test coverage for permission request records from Codex approval gates,
`session_metadata_update` from `thread_goal_updated` and `session_index.thread_name`, custom-channel tool calls (`apply_patch` single/multi-file dispatch,
`tool_search` round-trip), `web_search_call` mapping, argv-form shell argument quoting, and
spinner-glyph stripping. `user_interrupt` synthesis remains deferred — see the deferred-shapes
section below for why no real Codex session on the verifying contributor's machine emitted an
interrupt envelope. The storage layout deviates from the issue body's "mangled-cwd" assumption:
real Codex sessions live under a date-partitioned tree (`sessions/YYYY/MM/DD/rollout-*.jsonl`)
with no per-cwd subdir, so `detectSessions` walks the full tree and filters by the cwd recorded in
each file's header. The adapter `name` is `"codex"` (discovery handle); the trail header's
`agent.name` is `"codex-cli"` (the reserved schema agent name).
Codex also keeps session titles in a sidecar `session_index.jsonl` at the Codex home root; rows
have `{id, thread_name, updated_at}` and join to rollout files by `id == session_meta.payload.id`.

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
  - `exec_command` / `shell_command` (the canonical interactive-shell tools in real Codex
    rollouts) with
    `arguments` JSON carrying `cmd` plus optional `workdir`, and the forward-compat permission /
    timing fields (`yield_time_ms`, `max_output_tokens`, `justification`,
    `sandbox_permissions`, `prefix_rule`, `login`, `tty`) → `shell_command` with
    `args.command` and `args.cwd` populated from `workdir`. Extras are ignored.
  - `shell` / `container.exec` (defensive fallbacks for older session shapes) → same
    `shell_command` mapping.
  - Shell arguments accept three shapes: `{cmd: "..."}`, `{command: "..."}`, and
    `{command: ["bash", "-lc", "..."]}` argv-form. Argv-form joins with POSIX-safe quoting
    (same helper Pi uses) so the canonical `args.command` is always a single string.
  - `write_stdin` with non-empty `chars` → `shell_input{input, session_id?}`; numeric
    `session_id` is stringified. Empty or missing `chars` → `shell_output{command_id?}`.
  - `request_user_input` → `user_query`.
  - `tool_search` → `tool_search`.
  - MCP-shaped names (`mcp__<server>__<tool>`) or args with `namespace:"mcp__<server>"`
    → `mcp_call{server, tool, args}`.
  - `read` with `{path}` → `file_read`.
  - Anything else → `other` with `args = {name, args:{...}}`. Vendor tool names are passed
    through unchanged; `tools.<name>` prefix is stripped per spec convention (defensive — no
    real session observed with the prefix on this machine).
- `response_item.payload.type == "function_call_output"` → `tool_result` paired via `call_id` →
  emitted `tool_call.id` (also surfaced under `semantic.call_id` on both records). `output` is
  spinner-strip cleaned: trailing TUI decorations (a `\n` followed by `·` and a space) are
  removed when the trim region contains an unambiguous spinner glyph (`·`, `•`); natural
  trailing whitespace such as a shell command's `\n` is preserved. For paired
  `request_user_input` calls, Codex's JSON `{"answers": ...}` output is converted to
  `user_query_response`.
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
  `action.type == "open_page"` with `url` → `tool_call{tool:"web_fetch", args:{url}}`.
  Anything else falls through to `other`.
- `response_item.payload.type == "tool_search_call"` / `tool_search_output` →
  `tool_call{tool:"tool_search", args:{query, limit?}}` + paired `tool_result` when a query is
  recoverable. Output is the JSON-stringified `tools` array.
- `response_item.payload.type == "reasoning"` — Codex stores reasoning twice: an opaque
  `encrypted_content` blob (still ignored; no plaintext recoverable) and an optional
  plaintext `summary[]` array. Each `summary[]` element is a distinct reasoning section (the
  boundaries the streaming `agent_reasoning_section_break` events delimit), so the adapter emits
  **one deduped `agent_thinking` per section** (`metadata["dev.codex.raw_type"] =
  "response_item.reasoning.summary"`) rather than joining sections with `\n` — section structure
  is preserved and this matches how every other adapter records thinking blocks.
- `event_msg.payload.type == "agent_reasoning"` and `event_msg.payload.type ==
  "agent_reasoning_raw_content"` both → `agent_thinking` (canonical text is `payload.text`, no
  `message` fallback). Within a turn (`turn_context.payload.turn_id`), normalised-text duplicates
  collapse to a single entry; origin is recorded under `metadata["dev.codex.raw_type"]` (schema's
  `sourceMetadata` is `additionalProperties: false`, so the audit tag lives under reverse-DNS
  entry metadata per spec §11 — same precedent as Pi). The per-section dedupe pool spans both the
  streaming `event_msg` reasoning and the persisted `response_item.reasoning.summary[]` sections,
  folding exact duplicates while letting divergent sections through.
- `event_msg.payload.type == "agent_reasoning_section_break"` — recognized by the source schema
  and intentionally dropped (a streaming-UI marker; the persisted `summary[]` already carries the
  sections), so it is not quarantined.
- Top-level `compacted` record → `context_compact`. The summary text lives at `payload.message`
  (real shape — not `payload.summary`), with `payload.replacement_history` carrying the folded
  message list. The adapter preserves an elision marker for `replacement_history` under
  `source.raw` rather than inlining the folded transcript text. `event_msg.payload.type ==
  "context_compacted"` is an empty notification marker that fires alongside; the adapter ignores it
  since the canonical content lives on the top-level record.
  `payload.trigger` is hard-coded to `"auto"` (Codex auto-compaction has no manual signal).
  `tokens_before` / `tokens_after` are emitted only when the source happens to carry them.
- `event_msg.token_count` → rolls up onto the preceding `agent_message.payload.usage`
  (spec §9.2 `agentMessageUsage`). Codex carries `payload.info.last_token_usage` (delta) and
  `payload.info.total_token_usage` (cumulative); the adapter translates Codex field names to
  spec slots: `cached_input_tokens` → `cache_read_tokens` (delta only — spec has no cumulative
  slot), `reasoning_output_tokens` → `reasoning_tokens` (delta only), `last_token_usage`
  `{input,output}_tokens` → `{input,output}_tokens`, `last_token_usage.input_tokens` →
  `context_input_tokens`, `total_token_usage` `{input,output}_tokens` →
  `{input,output}_tokens_cumulative`, and `model_context_window` → `context_window_tokens` when
  present. Codex's `total_tokens` field is dropped (recoverable from input+output). `payload.info: null` rate-limit-only snapshots emit no usage; multiple
  `token_count` records targeting the same `agent_message` follow last-wins (cumulative totals
  are monotonic). The `payload.rate_limits` slot is intentionally not rolled up — see deferred
  shapes below.
- In-session model setting: synthesized `model_change` is emitted when
  `turn_context.payload.model` is first observed (`trigger:"initial"`) and when consecutive
  values differ (`trigger:"runtime_inferred"`). `payload.from_model` is the last observed model
  on changes; `payload.to_model` is the new value. `source.synthesized: true` and
  `metadata["dev.codex.raw_type"] = "turn_context.model_change"` flag the synthetic origin.
- Recorded VCS: the `session_meta` payload's `git { commit_hash, branch, repository_url }`
  (sibling of the flattened SessionMeta fields) populates `header.vcs` and is authoritative —
  live `readGitVcs(cwd)` runs only as a fallback when no recorded `git` block exists (correct for
  archived / replayed / shared trails). `repository_url` routes through `normalizeRemoteUrl`.
- SessionMeta extras → `header.meta` (reverse-DNS `dev.codex.*`): `model_provider` →
  `dev.codex.model_provider`; `memory_mode` → `dev.codex.memory_mode`; `base_instructions.text`
  (the system prompt, kept verbatim under `source.raw`) → a `dev.codex.base_instructions`
  fingerprint `{sha256, bytes}` that survives share-time elision and flags customization without
  inlining KBs of boilerplate. `dynamic_tools` is captured separately as `capability_change`.
- `turn_context` policy context: the initial tuple (`approval_policy`, `sandbox_policy`,
  `network`, `file_system_sandbox_policy`, `permission_profile`, `active_permission_profile`,
  `personality`, `collaboration_mode`, `effort`, `current_date`, `timezone`) snapshots into
  `header.meta["dev.codex.turn_context"]`. First observations and changes emit first-class
  events: permission axis → `mode_change{scope:"permission"}`; sandbox axis →
  `mode_change{scope:"execution"}`; `collaboration_mode` →
  `mode_change{scope:"collaboration"}`; `effort` → `thinking_level_change`. Remaining
  personality changes use `x-codex/turn_context`.

Diagnostic `system_event` emissions:

- `event_msg.error` → `system_event{kind:"agent_error"}`. `text` carries the message;
  `data` carries `severity:"error"`, `code` when available from `codex_error_info`, and
  `details`.
- `event_msg.warning` → `system_event{kind:"agent_warning"}` with
  `data.severity:"warning"` and `details`.
- `event_msg.guardian_warning` → `system_event{kind:"guardian_alert"}` with
  `data.severity:"warning"` and `details`.
- `event_msg.model_reroute` → `system_event{kind:"model_rerouted"}` with
  `data.from`, `data.to`, and `data.reason`.
- `event_msg.model_verification` → `system_event{kind:"model_rerouted"}` with
  `data.reason:"model_verification"` and the verification list under `data.details`.
- `event_msg.deprecation_notice` → `system_event{kind:"deprecation_notice"}` with
  `text` from the source summary and optional details.
- `event_msg.stream_error` → `system_event{kind:"stream_error"}` with
  `data.severity:"error"`, optional `code`, and `details`.

Lifecycle-vocabulary `system_event` emissions:

- `event_msg.task_started` → `system_event{kind:"task_started"}` (reserved §9.3). `data`
  carries `turn_id`, `started_at`, `model_context_window`, `collaboration_mode_kind` when
  present.
- `event_msg.item_started` → `system_event{kind:"x-codex/item_started"}`. `data` carries
  `thread_id`, `turn_id`, `started_at_ms`, and the source `item` object without inventing
  task-plan status snapshots.
- `event_msg.task_complete` (singular in the source — `task_completed` is the canonical
  schema kind) → `system_event{kind:"task_completed"}`. `data` carries `turn_id`,
  `completed_at`, `duration_ms`, `time_to_first_token_ms`, `last_agent_message`. The source
  wording is preserved under `metadata["dev.codex.raw_type"] = "event_msg.task_complete"`.
- `event_msg.hook_started` / `event_msg.hook_completed` →
  `system_event{kind:"hook_fired"}`. `data` carries `turn_id` and curated hook run fields
  (`id`, event/scope/status/timing fields, and output entries).
- `event_msg.exec_command_begin` → `system_event{kind:"x-codex/exec_command_begin"}` with
  `semantic.call_id`. `data` carries `call_id`, `turn_id`, `process_id`, `started_at_ms`,
  `command`, `cwd`, `parsed_cmd`, source, and bounded interaction-input presence/length
  markers when present.
- `event_msg.exec_command_end` → `system_event{kind:"x-codex/exec_command_end"}` with
  `semantic.call_id` linking to the originating `exec_command` tool_call. `data` carries
  `turn_id`, `completed_at_ms` (the true command-finish time; the entry `ts` stays the envelope
  arrival time for stream order), `command`, `cwd`, `exit_code`, `duration_ms`, truncated
  `stdout_excerpt` / `stderr_excerpt` (capped to ~2KB per side), `status`, and the parsed-command
  structure.
- `event_msg.exec_approval_request` / `event_msg.request_permissions` /
  `event_msg.apply_patch_approval_request` / `event_msg.elicitation_request` →
  `system_event{kind:"permission_request"}`. `semantic.call_id` links when the source carries a
  `call_id`; `data` preserves source pairing ids (`tool_call_id`, `approval_id`, `request_id`) and
  request context such as `turn_id`, `started_at_ms`, `reason`, `prompt`, `command`, `cwd`,
  `permissions`, `changes`, `grant_root`, `server_name`, and sanitized elicitation `request`
  metadata.
- `event_msg.patch_apply_end` → `system_event{kind:"x-codex/patch_apply_end"}` with
  `semantic.call_id` linking to the originating `apply_patch` tool_call. `data` carries
  `success`, `changes`, `stdout_excerpt`, `stderr_excerpt`, `status`.
- `event_msg.patch_apply_begin` / `event_msg.patch_apply_updated` →
  `system_event{kind:"x-codex/patch_apply_begin"}` /
  `system_event{kind:"x-codex/patch_apply_updated"}` with `semantic.call_id`. `data`
  carries source `call_id`, turn id, approval flag, and structured `changes` when present.
- `event_msg.mcp_tool_call_begin` → `system_event{kind:"x-codex/mcp_tool_call_begin"}` with
  `semantic.call_id`. `data` carries `call_id`, `plugin_id`, `invocation`, and
  `mcp_app_resource_uri` when present.
- `event_msg.mcp_tool_call_end` → `system_event{kind:"x-codex/mcp_tool_call_end"}` with
  `semantic.call_id`. `data` carries `plugin_id`, `invocation`, `duration_ms`, and a
  flattened `result_ok` boolean derived from the Rust-style `{Ok|Err: …}` enum.
- `event_msg.web_search_begin` → `system_event{kind:"x-codex/web_search_begin"}` with
  `data.call_id`; the vendor id is not surfaced as `semantic.call_id` unless paired to a
  registered source tool call.
- `event_msg.web_search_end` → `system_event{kind:"x-codex/web_search_end"}`. Pairing is
  query-based: consumers join by matching `data.query` against the `web_search` tool_call's
  `args.query`. The source `ws_*` vendor id is preserved verbatim under `data.call_id` for
  audit fidelity, but is not surfaced as `semantic.call_id` because no `tool_call` was
  registered against it (`web_search_call` carries no `call_id` in the response_item channel).
- `event_msg.image_generation_begin` / `event_msg.image_generation_end` →
  `system_event{kind:"x-codex/image_generation_begin"}` /
  `system_event{kind:"x-codex/image_generation_end"}`. `data` preserves source `call_id`,
  status, revised prompt, result, and saved path when present; the vendor id is not surfaced as
  `semantic.call_id` unless paired to a registered source tool call.
- `event_msg.thread_goal_updated` → `session_metadata_update`. When `goal.summary` is a non-empty
  string, it updates `description`; otherwise the raw goal object is preserved under
  `x-codex/thread_goal`.
- `session_index.thread_name` → `session_metadata_update{field:"name", reason:"external"}`.
  `updated_at` supplies the event timestamp. Rows without a non-empty `thread_name` or valid
  timestamp are ignored.
- `event_msg.turn_aborted` → `user_interrupt`, preserving the observed `reason` string
  (for example, `"interrupted"`). The adapter does not fabricate
  `tool_call_aborted.for_id` because current source evidence is turn-level.
- `event_msg.item_completed` → `system_event{kind:"x-codex/item_completed"}`. `data`
  carries `turn_id` and the completed `item` (currently observed for task-plan `Plan`
  items; a dedicated task-plan event is tracked separately).
- `response_item.message` — text-only records are suppressed as duplicates of
  `event_msg.user_message` / `event_msg.agent_message`. Image-bearing records fold
  reference-only attachments (`sha256:` for inline `data:` images) onto the nearest matching
  event-message echo, with a standalone message fallback when no echo is present.

Capability-registry emissions:

- `session_meta.payload.dynamic_tools` → `capability_change{scope:"tool", reason:"loaded"}` with
  `snapshot`. The adapter keeps only compact `metadata` (`namespace`, `description`,
  `defer_loading`) and intentionally drops full tool input schemas.
- `event_msg.mcp_startup_update` / `event_msg.mcp_startup_complete` →
  `capability_change{scope:"mcp_server"}`. Starting maps to `loaded`, ready to `connected`,
  failed to `error`, and cancelled to `disconnected`.
- `DynamicToolCallRequest` / `DynamicToolCallResponse` are dynamic tool invocation records, not
  registry changes; they are not mapped to `capability_change`.

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
- `event_msg.error` / `warning` / `guardian_warning` / `model_reroute` /
  `model_verification` / `deprecation_notice` / `stream_error` — diagnostic events.
- `event_msg.task_started` / `event_msg.item_started` / `event_msg.task_complete` —
  lifecycle bookends.
- `event_msg.hook_started` / `event_msg.hook_completed` — hook run lifecycle markers.
- `event_msg.exec_command_begin` / `event_msg.exec_command_end` /
  `event_msg.patch_apply_begin` / `event_msg.patch_apply_updated` /
  `event_msg.patch_apply_end` / `event_msg.mcp_tool_call_begin` /
  `event_msg.mcp_tool_call_end` / `event_msg.web_search_begin` /
  `event_msg.web_search_end` / `event_msg.image_generation_begin` /
  `event_msg.image_generation_end` — paired enrichment events.
- `event_msg.exec_approval_request` / `event_msg.request_permissions` /
  `event_msg.apply_patch_approval_request` / `event_msg.elicitation_request` — approval and
  permission request markers.
- `event_msg.thread_goal_updated` — goal change marker.
- `event_msg.turn_aborted` — user interrupt marker.
- `event_msg.item_completed` — completed turn item marker.
- `response_item.message` — image-bearing message carrier.

Deferred shapes (hardening follow-ups beyond the current verified slice):

- `event_msg.token_count.payload.rate_limits` — Codex carries API rate-limit snapshots
  (window utilization, reset window) on the same record as token usage. The Agent Trail spec
  has no `agentMessageUsage` slot for rate-limit state, so this field is dropped during the
  usage rollup. A future pass may emit these as standalone `system_event` records under an
  `x-codex/rate_limit_snapshot` kind; deferred until the emission frequency and dedupe policy
  (rate_limits fire on every token_count, often unchanged) can be designed in its own review.
- Text-only `response_item.message` reconstruction when no `event_msg.user_message` /
  `event_msg.agent_message` echo fires. The verified v0.135 corpus duplicates text across both
  channels, so text-only response items are suppressed today; image-bearing response items keep
  their attachment signal through the rollup/fallback path above.
- Encrypted reasoning recovery — `response_item.reasoning` with `encrypted_content` carries
  no plaintext and stays skipped until a key surfaces.
- Ambiguous or missing `spawn_agent` child rollout matching — direct child sessions are bundled only
  when `agent_id` resolves to exactly one child file. Missing, ambiguous, or external child files are
  warning-tolerant and leave `subagent_invoke.args.session_id` unset.
- `~/.codex/config.toml` profile reading for model identity — `turn_context.payload.model`
  is already canonical; profile file is redundant noise unless future sessions diverge.
- 12s `event_msg` ↔ `response_fallback` dedupe — no `response_fallback` records observed in
  the corpus; defer until evidence.
- `request_user_input` Q&A reconstruction is verified from local real sessions: the request is a
  `function_call` mapped to `user_query`, and the answer arrives as paired
  `function_call_output` JSON with an `answers` key mapped to `user_query_response`.

Opt-in real-session test hook: `packages/adapters/src/codex/real-session.test.ts` reads
`AGENT_TRAIL_REAL_CODEX_SESSION` (absolute path to a real Codex JSONL session) and skips when
unset. Real sessions stay out of git per the fixture policy below.

Claude Code fixture coverage currently includes mixed assistant content blocks, multiple tool calls,
multiple tool results, tool-result error state, user text blocks, thinking/redacted-thinking blocks,
real summary and compact-summary records, meaningful system/progress/queue records, hook-success
attachments, user interrupt markers (both `[Request interrupted by user]` and
`[Request interrupted by user for tool use]` variants observed in real sessions), and in-session
model switches (emitted as synthetic `model_change` entries with `source.synthesized: true` when
assistant `message.model` shifts).
`AskUserQuestion` requests emit `user_query`; user-side `tool_result` blocks linked by
`tool_use_id` are converted to `user_query_response`.

Claude Code assistant `message.usage` maps Anthropic-style token counters to
`agent_message.payload.usage`: `input_tokens` / `output_tokens` pass through,
`cache_read_input_tokens` → `cache_read_tokens`, `cache_creation_input_tokens` →
`cache_creation_tokens`, and `context_input_tokens = input_tokens + cache_read_input_tokens +
cache_creation_input_tokens`. No reliable model context-window size has been observed in Claude Code
JSONL, so the adapter omits `context_window_tokens`.

Deferred shapes include server-tool result blocks, ambiguous prompt-only subagent matching
hardening, recursive child-session inclusion beyond direct children, and overflow blob storage.
Inline image/document blocks are captured as `user_message.attachments` with content-addressed
`sha256:` refs when the decoded bytes are below the inline cap; oversized inline media keeps
attachment metadata without decoding into a URI.

Emitted `system_event.kind` values (spec §9.3):

Reserved lifecycle vocabulary (cross-agent portable):

- `session_start` — `progress` envelope with `data.hookEvent == "SessionStart"`, plus continuation-preamble user messages.
- `session_end` — `progress` envelope with `data.hookEvent == "SessionEnd"`.
- `turn_end` — `progress` envelope with `data.hookEvent == "Stop"`, plus `system` envelope with `subtype == "stop_hook_summary"`.
- `subagent_end` — `progress` envelope with `data.hookEvent == "SubagentStop"`.
- `pre_tool_use` — `progress` envelope with `data.hookEvent == "PreToolUse"`.
- `post_tool_use` — `progress` envelope with `data.hookEvent == "PostToolUse"`.
- `session_start` / `turn_end` / `pre_tool_use` / `post_tool_use` / `hook_fired` —
  `attachment.hook_success`, preserving `hook_event`, `hook_name`, `tool_call_id`, command,
  exit code, duration, and stdout/stderr excerpts when present.
- `permission_request` — `progress` envelope with `data.hookEvent == "Notification"`.
- `permission_request` — `attachment.command_permissions`, preserving `allowed_tools` and `model`.
- `permission_decision` — `attachment.hook_permission_decision`, preserving explicit
  allow/deny decisions and `tool_call_id` when present.
- `hook_fired` — `progress` envelope with `data.type == "hook_progress"` and an unrecognized `hookEvent` (forward-compatibility fallback).
- `queue_operation` — `queue-operation` envelope. id synthesized (`source.synthesized: true`) because the source records lack `uuid`.

Note: `system_event.kind:"permission_mode_change"` remains schema-accepted as a deprecated v0.1.0 compatibility value. Current adapters do not emit it.

Reserved diagnostic vocabulary (cross-agent portable):

- `api_error` — `system` envelope with `subtype == "api_error"`. `data` carries
  `severity:"error"` and the source content as `details` when present.
- `hook_failed` — `system.subtype == "stop_hook_summary"` `hookErrors[]`,
  `attachment.hook_non_blocking_error`, and `attachment.hook_blocking_error` without a usable
  tool call id. `data`
  carries `severity:"error"`, `blocking`, `hook_name`, `code`, and `details` when
  present.

Vendor extensions (Claude Code-specific):

- `x-claudecode/turn_duration` — `system` envelope with `subtype == "turn_duration"` (duration metadata for the just-completed turn; `turn_end` is preferred for boundary semantics).
- `x-claudecode/away_summary` — `system` envelope with `subtype == "away_summary"` (Claude Code "you were away" recap).
- `x-claudecode/local_command` — `system` envelope with `subtype == "local_command"` (slash-command stdout).
- `x-claudecode/bridge_status` — `system` envelope with `subtype == "bridge_status"` (remote-control bridge).
- `x-claudecode/compact_boundary` — `system` envelope with `subtype == "compact_boundary"` (compaction metadata; the canonical `context_compact` entry is produced from the summary envelope, and a prior boundary can populate `context_compact.payload.replaced_message_ids` with folded emitted entry ids).
- `x-claudecode/hook_additional_context` — `attachment.hook_additional_context` injected into the
  prompt by a hook. `payload.text` and `data.content` preserve text blocks up to 16,384 characters
  after concatenating multi-block text; inline image/document blocks are represented under
  `data.attachments` as hashed attachment refs rather than raw base64.
- `x-claudecode/<subtype>` — fallback for unknown safe-named `system` subtypes.
- `x-claudecode/system` — fallback for `system` envelopes without a recognizable subtype.
- `x-claudecode/progress` — fallback for `progress` envelopes whose `data.type` is not `hook_progress`.
- `x-claudecode/pr_link` — `pr-link` envelope. id synthesized (`source.synthesized: true`).

Vendor kinds are not portable across agents. Promote to the reserved enum (with a minor spec version bump) if another adapter ends up emitting the same shape.

Capability-registry attachments:

- `attachment.deferred_tools_delta` → `capability_change{scope:"tool"}`. Mixed add/remove
  payloads split into separate `registered` and `deregistered` events.
- `attachment.skill_listing` → `capability_change{scope:"skill", reason:"loaded"}`. Structured
  names become a `snapshot`; string-only listings become a `changed` record preserving the listing
  text without inventing skill names.
- `attachment.mcp_instructions_delta` →
  `capability_change{scope:"mcp_server", reason:"instructions_updated"}`.
- `attachment.hook_blocking_error` with a usable tool call id →
  `tool_call_aborted{scope:"tool_call", reason:"hook_blocked"}` linked to the matching
  `tool_call`. Without a usable id it remains `system_event{kind:"hook_failed"}`.
- `attachment.hook_non_blocking_error` → `system_event{kind:"hook_failed"}`.

Session metadata from non-message envelopes:

- `ai-title` → `session_metadata_update{field:"name", reason:"ai_generated"}`.
- `agent-name` → `session_metadata_update{field:"x-claudecode/agent_name", reason:"ai_generated"}`.
- `worktree-state` → `session_metadata_update` for `vcs.branch` and `vcs.worktree`.
  When `worktreeSession.originalHeadCommit` is present, the same transcript record seeds
  session-time `header.vcs.revision` / `head_commit`; `header.vcs.branch` comes only from the first
  tracer `gitBranch`. Field provenance is recorded in
  `header.meta["dev.agent-trail.vcs_provenance"]`. Live git discovery from `header.cwd` is not used
  for Claude Code headers.
- `gitBranch` on normal tracer records → one synthesized
  `session_metadata_update{field:"vcs.branch", reason:"runtime_inferred"}` when no
  `worktree-state` branch update exists. This preserves Claude Code's observed session-time branch
  signal without inventing a `header.vcs` block when no session-time commit is available.

## Fixture policy

Agent Trail adapter work distinguishes two kinds of fixtures:

1. **Committed fixtures** must be synthetic or manually redacted real-source fixtures. They live under `packages/adapters/tests/fixtures/`; storage-tree or SQLite adapters may also use committed fixture-building tests under `packages/adapters/src/` when a single source file is not the source format. All fixtures and builders are reviewed in PRs. No raw transcript text, no PII, no secrets, no API keys, no real user identifiers, no contributor-local file paths, no private repository URLs, and no opaque encrypted reasoning blobs. Synthetic fixtures should use synthetic ids, agent names, timestamps, and one scenario per file or test case. Redacted real-source fixtures may preserve source ids, source schema structure, event types, safe enum values, model ids, and tool or schema field names when they do not identify a person, local machine, private repository, or transcript text. Their source text and matching expected Agent Trail output must both be redacted and covered by leak checks.

2. **Real local sessions** stay out of git. Adapters may include opt-in real-session smoke tests that load default agent session roots or a custom path from an environment variable and skip in CI. These tests run on the contributor's machine, never in CI, and never check raw local session data into the repo.

An adapter PR is not eligible to move its matrix row from `pending verification` to `verified` until:

- At least one committed synthetic fixture or fixture-building test exercises the adapter's main entry types.
- The verification date and source-agent version are filled in.
- Observed entry types and fixture names columns reflect the committed fixtures or fixture-building tests.

If real-session debugging produces a fixture worth committing, manually redact it first, add the redacted source fixture under `packages/adapters/tests/fixtures/`, generate the matching expected trail from that redacted source, and review both files. The redacted fixture, not the raw session, is what locks behavior.

## Update procedure

When an adapter author verifies behavior against a new source-agent version:

1. Run the adapter's fixture tests against the new source-agent release.
2. Update the row's `Verified on`, `Source-agent version`, `Observed entry types`, and `Fixture names` columns.
3. If new entry types appeared, add a fixture under `packages/adapters/tests/fixtures/` or a fixture-building adapter test covering each, and reference it in the matrix.
4. If existing entry types changed shape, treat as a breaking source-format change: note it in the row, add a fixture for the new shape, keep the prior fixture if older versions remain supported.
5. Flip status to `verified` once all of the above are in the PR.

A row going stale (no re-verification against a current source-agent release) does not automatically downgrade, but adapter authors should re-verify on a cadence proportional to the source agent's release velocity.
