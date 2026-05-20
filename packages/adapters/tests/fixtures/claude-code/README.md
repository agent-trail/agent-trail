# Claude Code adapter fixtures

Synthetic Claude Code source-format JSONL files used by `packages/adapters/src/claude-code/`
tests. Every fixture in this directory MUST be synthetic. No real session content, no PII, no
secrets, no contributor file paths, no real session ids. Real local sessions stay out of git per
[`docs/parser-source-matrix.md`](../../../../../docs/parser-source-matrix.md) fixture policy.

## Scenarios

| File | Scenario | Records | Mapped entries |
|---|---|---|---|
| `basic-flow.jsonl` | Linear user → assistant tool_use → user tool_result → assistant text → summary, with `queue-operation`, `attachment`, and `isSidechain: true` records mixed in as noise | 8 source records | 5 entries (user_message, tool_call, tool_result, agent_message, session_summary) |

## Adding a fixture

1. Use synthetic ids (`cc-evt-N`, `tooluse-N`, `sess-cc-N`) and synthetic timestamps in the
   `2026-05-17T14:00:00.000Z` family.
2. Set `version` to `1.0.0-synthetic` (or a clearly-synthetic variant) to make accidental
   real-session checkins easy to spot in review.
3. One scenario per file. Name the file after the scenario (kebab-case).
4. Add a row to the table above describing the scenario and the entries it covers.
