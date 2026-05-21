# Parser Source Matrix

The living record of adapter source formats, verification dates, and fixture coverage. This document is the canonical source of truth for which source agents Agent Trail adapters cover, what was verified, when, and which committed fixtures lock that behavior.

See PRD [§7.2](./PRD.md) for the product specification of this matrix, and [`CONTEXT.md`](../CONTEXT.md) for the glossary entry. Modeled after [hwisu/opensession's parser-source-matrix.md](https://github.com/hwisu/opensession/blob/main/docs/parser-source-matrix.md).

## Status legend

- `pending verification` — adapter not yet implemented, or storage format not yet verified against the listed source-agent version.
- `verified` — adapter implemented, fixtures committed under `tests/fixtures/`, and behavior locked against the listed source-agent version on the listed verification date.
- `deprecated` — adapter or source format no longer covered. See notes for migration guidance.

An adapter is only considered supported once its row is `verified` with at least one committed synthetic fixture.

## Matrix

| Source agent | Source status | Storage format(s) | Reuse boundary | Reference URL | Verified on | Source-agent version | Observed entry types | Fixture names | Status |
|---|---|---|---|---|---|---|---|---|---|
| Pi | open | JSONL at `~/.pi/agent/sessions/<mangled-cwd>/<sessionId>.jsonl` | re-implement | https://github.com/badlogic/pi-mono | 2026-05-21 | 3-synthetic | user_message, agent_message, tool_call, tool_result | pi/linear-flow.jsonl | verified |
| Claude Code | closed | JSONL at `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl` | re-implement | https://docs.anthropic.com/claude-code | 2026-05-20 | 1.0.0-synthetic | user_message, agent_message, tool_call, tool_result, session_summary, agent_thinking, system_event, context_compact, user_interrupt, model_change | claude-code/basic-flow.jsonl; claude-code/fidelity-edge-cases.jsonl; claude-code/interrupt-and-model-change.jsonl | verified |
| Codex CLI | open | — | re-implement | — | — | — | — | — | pending verification |
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
`edit` has three empirically-observed Pi argument shapes:
(a) single-replace `{path, oldText, newText}` → `file_edit` with a one-hunk unified diff;
(b) `{multi: [{path, oldText, newText}, ...]}` collapsing to a single file → `file_edit` with a
multi-hunk diff;
(c) `{multi: [...]}` spanning multiple files, or `{patch: "*** Begin Patch..."}` apply_patch
strings → `other`, since spec §10.1 `file_edit` is single-file unified-diff only.
Any other tool name (including MCP-extension tools real Pi sessions carry — `web_search`,
`fetch_content`, custom user tools) falls through to the `other` escape hatch per spec §10.5,
mirroring how Pi's own `/share` export-html renderer JSON-dumps unknown tools. Deferred
shapes (covered by follow-up issues #19 and #20): `branch_summary` and tree branches, `compaction`,
`model_change`, `thinking_level_change`, `bashExecution`, `custom` / `custom_message`, `label`,
`session_info`, `parentSession` forked sessions, `agent_thinking` from Pi `thinking` blocks,
`user_interrupt` markers, polymorphic timestamp parsing, and the opt-in real-session test hook.

Claude Code fixture coverage currently includes mixed assistant content blocks, multiple tool calls,
multiple tool results, tool-result error state, user text blocks, thinking/redacted-thinking blocks,
real summary and compact-summary records, meaningful system/progress/queue records, user interrupt
markers (both `[Request interrupted by user]` and `[Request interrupted by user for tool use]`
variants observed in real sessions), and in-session model switches (emitted as synthetic
`model_change` entries with `source.synthesized: true` when assistant `message.model` shifts).
Deferred shapes include image attachments, server-tool result blocks, cross-file subagent merging,
and overflow blob storage.

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
