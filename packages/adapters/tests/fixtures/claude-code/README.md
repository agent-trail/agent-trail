# Claude Code adapter fixtures

Synthetic Claude Code source-format JSONL files used by `packages/adapters/src/claude-code/`
tests. Every fixture in this directory MUST be synthetic. No real session content, no PII, no
secrets, no contributor file paths, no real session ids. Real local sessions stay out of git per
[`docs/parser-source-matrix.md`](../../../../../docs/parser-source-matrix.md) fixture policy.

## Scenarios

| File | Scenario | Records | Mapped entries |
|---|---|---|---|
| `basic-flow.jsonl` | Linear user → assistant tool_use → user tool_result → assistant text → summary. Envelope fields mirror real Claude Code session shape (`promptId`, `userType`, `entrypoint`, `gitBranch`, `slug`, assistant `message.id`/`type`/`stop_reason`/`stop_details`/`usage`, `requestId`, tool_use `caller`, attachment `hookName`/`stdout`/`stderr`/`exitCode`/`durationMs`). Noise records exercise filters for `attachment`, `isSidechain: true`, and `isMeta: true` slash-command body; the uuid-less queue record is not emitted. | 9 source records | 5 entries (user_message, tool_call, tool_result, agent_message, session_summary) |
| `fidelity-edge-cases.jsonl` | Mixed assistant text/thinking/redacted_thinking/multiple tool_use blocks, user text plus multiple tool_result blocks including an error, Claude system/progress/queue records, continuation preamble, real summary shape, and compact summary shape. | 9 source records | 15 entries (user_message, agent_message, agent_thinking, tool_call, tool_result, system_event, session_summary, context_compact) |

## Adding a fixture

1. Use synthetic ids (`cc-evt-N`, `tooluse-N`, `sess-cc-N`) and synthetic timestamps in the
   `2026-05-17T14:00:00.000Z` family.
2. Set `version` to `1.0.0-synthetic` (or a clearly-synthetic variant) to make accidental
   real-session checkins easy to spot in review.
3. One scenario per file. Name the file after the scenario (kebab-case).
4. Add a row to the table above describing the scenario and the entries it covers.
