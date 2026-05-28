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
| Codex CLI | open | JSONL at `~/.codex/sessions/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl` (or `CODEX_HOME/sessions/`); dual-format (legacy CLI flat / desktop-wrapped) | re-implement | https://github.com/openai/codex | 2026-05-28 | 0.98.0-synthetic | user_message, agent_message, tool_call, tool_result, agent_thinking, context_compact, model_change | codex/desktop-tracer.jsonl; codex/legacy-tracer.jsonl; codex/reasoning-dedupe.jsonl; codex/compact-and-model-change.jsonl | verified |
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

Codex CLI fixture coverage (issue #32 PR1 tracer slice) targets the four mandated event kinds
(`agent_thinking`, `user_interrupt`, `context_compact`, `model_change`) plus the baseline
message + tool pair. The storage layout deviates from the issue body's "mangled-cwd" assumption:
real Codex sessions live under a date-partitioned tree (`sessions/YYYY/MM/DD/rollout-*.jsonl`)
with no per-cwd subdir, so `detectSessions` walks the full tree and filters by the cwd recorded in
each file's header. The adapter `name` is `"codex"` (discovery handle); the trail header's
`agent.name` is `"codex-cli"` (the reserved schema agent name).

Dual format dispatch (issue #32 §"Dual format dispatch"): the parser inspects the first non-empty
JSONL line and routes — `type === "session_meta"` → desktop-wrapped (`session_meta` + nested
`response_item` / `event_msg` / `turn_context` envelopes), `id` + `timestamp` and no `type`
field → legacy-cli flat JSONL. Real sessions on the verifying contributor's machine were all
desktop-wrapped (Codex CLI 0.98.0, originator `codex_sdk_ts`); the legacy-cli branch is exercised
by the committed `codex/legacy-tracer.jsonl` fixture per the issue body's described shape but has
not been ground-truthed against a real legacy session.

PR1 entry-type mapping:

- `response_item.payload.type == "message"` → `user_message` (`role == "user"`) or `agent_message`
  (`role == "assistant"`). Text is concatenated from `content[].text` blocks (`input_text`,
  `output_text`, `text`).
- `response_item.payload.type == "function_call"` → `tool_call`. Tool-kind canonical map (PR1):
  - `shell` / `container.exec` with `arguments` JSON `{cmd}` or `{command:"<string>"}` →
    `shell_command` with `args.command`. Argv-form (`{command:[…]}`) is deferred to PR2.
  - `read` with `{path}` → `file_read`.
  - Everything else, including `apply_patch` (patch-path inference is PR2 hardening) and
    `custom_tool_call` (vendor canonicalization is PR2), is routed to `other` with `args = {name,
    args}` to keep the payload schema-valid without claiming canonical kinds we don't yet parse
    end-to-end.
- `response_item.payload.type == "function_call_output"` → `tool_result` paired via `call_id` →
  emitted `tool_call.id` (also surfaced under `semantic.call_id` on both records).
- `event_msg.payload.type == "agent_reasoning"` and `event_msg.payload.type ==
  "agent_reasoning_raw_content"` both → `agent_thinking`. Within a turn (`turn_context.payload
  .turn_id`), normalised-text duplicates collapse to a single entry; origin is recorded under
  `metadata["dev.codex.raw_type"]` (schema's `sourceMetadata` is `additionalProperties: false`,
  so the audit tag lives under reverse-DNS entry metadata per spec §11 — same precedent as Pi).
- `event_msg.payload.type == "context_compact"` → `context_compact` with `payload.summary`,
  `tokens_before` / `tokens_after` (when present), `trigger: "auto"` (Codex auto-compaction has
  no manual signal in the legacy/desktop streams).
- In-session model switch: synthesized `model_change` is emitted when consecutive
  `turn_context.payload.model` values differ. `payload.from_model` is the last observed model
  (initialised from the first `turn_context.model`); `payload.to_model` is the new value.
  `source.synthesized: true` and `metadata["dev.codex.raw_type"] = "turn_context.model_change"`
  flag the synthetic origin.

`dev.codex.raw_type` audit-tag values stamped by PR1:

- `response_item.message` — user or agent message via the response-item channel.
- `response_item.function_call` — tool call request.
- `response_item.function_call_output` — tool call output.
- `event_msg.agent_reasoning` — synthesized reasoning surface.
- `event_msg.agent_reasoning_raw_content` — raw reasoning surface.
- `event_msg.context_compact` — auto-compaction.
- `turn_context.model_change` — synthesized model-change marker.

Deferred shapes (PR2 hardening, follow-up issue):

- `user_interrupt` — real Codex interrupt signal not observed in any session on the verifying
  contributor's machine (Codex CLI 0.98.0). Acceptance criterion's matrix-absence path applies; no
  fixture committed in PR1. Distinct from `event_msg.turn_aborted` which is also PR2.
- `request_user_input` Q&A reconstruction; `web_search_call` → `tool_call{tool_kind:"web_search"
  | "web_fetch"}`; `custom_tool_call` vendor-name canonicalisation (`tools.` prefix strip);
  defensive shell argv-form parsing (`{command:[…]}`); apply_patch path inference from
  `*** Update/Add/Delete File:` markers; spinner-glyph output hygiene; 12s
  `event_msg` ↔ `response_fallback` dedupe; `task_started` / `task_complete` / `turn_aborted` /
  `plan_completed` `system_event` emissions; subagent header `fork_from` lineage via `agent_role`
  / `source.subagent.parent_thread_id`; `~/.codex/config.toml` profile reading for model identity;
  encrypted reasoning (`response_item.reasoning` with `encrypted_content`) — currently skipped
  since there is no plaintext.

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
