# Pi adapter fixtures

Synthetic Pi source-format JSONL files used by `packages/adapters/src/pi/` tests. Every fixture in
this directory MUST be synthetic. No real session content, no PII, no secrets, no contributor file
paths, no real session ids. Real local sessions stay out of git per
[`docs/parser-source-matrix.md`](../../../../../docs/parser-source-matrix.md) fixture policy.

## Scenarios

| File | Scenario | Records | Mapped entries |
|---|---|---|---|
| `linear-flow.jsonl` | Linear session header → user message → assistant `toolCall(read)` → `toolResult` → assistant text. Exercises tree-native `parentId` chain mapped to Agent Trail `parent_id` (spec §12.1), tool-call/tool-result pairing via `toolCallId`, integer Pi `version` stringified into `header.agent.version` / `header.source.format_version`. | 5 source records (1 header + 4 messages) | 4 entries (user_message, tool_call, tool_result, agent_message) |
| `branch-flow.jsonl` | Forked tree session: user → assistant → abandoned branch (user → assistant) → Pi-native `branch_summary` envelope → active branch (user → assistant). Exercises multi-leaf `parentId` topology (fork at `pi-a1`), `branch_summary` envelope → AT `branch_summary` event with `payload.abandoned_branch_id` resolved by walking `fromId` up to the divergence point with the active leaf (spec §9.3, §12.2), and `details` mirrored into `metadata["dev.pi.branch_details"]` per spec §11. | 8 source records (1 header + 6 messages + 1 branch_summary) | 7 entries (6 message entries + 1 branch_summary; envelopes drop nothing observable) |
| `reasoning-and-interrupt.jsonl` | Header → user → assistant `[thinking, text]` (stop) → user → assistant `[redacted-thinking, toolCall]` (`stopReason:"aborted"`). Exercises `agent_thinking` from pi-ai `ThinkingContent` blocks, redacted-thinking placeholder, and `user_interrupt` synthesized for `stopReason === "aborted"` per spec §9.3 (Pi has no dedicated interrupt envelope). | 5 source records (1 header + 4 messages) | 7 entries (user, thinking, text, user, redacted-thinking, toolCall, synthesized user_interrupt) |
| `compaction-and-model-change.jsonl` | Header (model A) → user → assistant (model A) → Pi-native `compaction` envelope → Pi-native `model_change` envelope (model B) → user → assistant (model B). Exercises `context_compact` mapping with `tokens_before` / `trigger:"auto"` and `metadata["dev.pi.compaction"]` mirror; `model_change` with `from_model` resolved from the last observed assistant `message.model` per spec §9.3. | 7 source records (1 header + 4 messages + 1 compaction + 1 model_change) | 6 entries (user, agent_message, context_compact, model_change, user, agent_message) |

## Real sessions

Real Pi sessions stay out of git per
[`docs/parser-source-matrix.md`](../../../../../docs/parser-source-matrix.md) fixture policy. The
adapter ships an opt-in test at `packages/adapters/src/pi/real-session.test.ts` that reads a path
from the `AGENT_TRAIL_REAL_PI_SESSION` environment variable:

```sh
AGENT_TRAIL_REAL_PI_SESSION=/abs/path/to/session.jsonl bun test packages/adapters
```

The test skips when the env var is unset, so it never runs in CI.

## Adding a fixture

1. Use synthetic ids (`pi-evt-N`, `pi-call-N`, `sess-pi-N`) and synthetic timestamps in the
   `2026-05-21T14:00:00.000Z` family.
2. Set `version` to `3` (current Pi schema) or a clearly-synthetic variant to make accidental
   real-session checkins easy to spot in review.
3. One scenario per file. Name the file after the scenario (kebab-case).
4. Add a row to the table above describing the scenario and the entries it covers.
