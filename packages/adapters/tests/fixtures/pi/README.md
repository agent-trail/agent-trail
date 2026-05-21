# Pi adapter fixtures

Synthetic Pi source-format JSONL files used by `packages/adapters/src/pi/` tests. Every fixture in
this directory MUST be synthetic. No real session content, no PII, no secrets, no contributor file
paths, no real session ids. Real local sessions stay out of git per
[`docs/parser-source-matrix.md`](../../../../../docs/parser-source-matrix.md) fixture policy.

## Scenarios

| File | Scenario | Records | Mapped entries |
|---|---|---|---|
| `linear-flow.jsonl` | Linear session header → user message → assistant `toolCall(read)` → `toolResult` → assistant text. Exercises tree-native `parentId` chain mapped to Agent Trail `parent_id` (spec §12.1), tool-call/tool-result pairing via `toolCallId`, integer Pi `version` stringified into `header.agent.version` / `header.source.format_version`. | 5 source records (1 header + 4 messages) | 4 entries (user_message, tool_call, tool_result, agent_message) |
| `branch-flow.jsonl` | Forked tree session: user → assistant → abandoned branch (user → assistant) → Pi-native `branch_summary` envelope → active branch (user → assistant). Exercises multi-leaf `parentId` topology (fork at `pi-a1`), `branch_summary` envelope → AT `branch_summary` event with `payload.abandoned_branch_id` resolved by walking `fromId` up to the divergence point with the active leaf (spec §9.3, §12.2), and `details` mirrored into `metadata["dev.pi-mono.branch_details"]` per spec §11. | 8 source records (1 header + 6 messages + 1 branch_summary) | 7 entries (5 message entries + 1 branch_summary; envelopes drop nothing observable) |

## Adding a fixture

1. Use synthetic ids (`pi-evt-N`, `pi-call-N`, `sess-pi-N`) and synthetic timestamps in the
   `2026-05-21T14:00:00.000Z` family.
2. Set `version` to `3` (current Pi schema) or a clearly-synthetic variant to make accidental
   real-session checkins easy to spot in review.
3. One scenario per file. Name the file after the scenario (kebab-case).
4. Add a row to the table above describing the scenario and the entries it covers.
