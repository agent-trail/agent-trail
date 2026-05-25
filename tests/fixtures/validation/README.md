# Validation fixtures

Committed synthetic trail files exercising the Agent Trail validation paths. All fixtures are reusable across `@agent-trail/core`, `@agent-trail/cli`, and future adapter tests.

Fixture policy for the workspace lives in [`docs/parser-source-matrix.md`](../../../docs/parser-source-matrix.md#fixture-policy): committed fixtures are synthetic or redacted; real local sessions stay out of git and are loaded only by opt-in ignored tests.

## Conventions

- File extension: `.trail.jsonl` (spec.md §5.1).
- Synthetic data only. No real session content, no PII, no secrets.
- Synthetic ids: `sess1`, `evta1`, `evta2`, ...; synthetic agent: `codex-cli`; synthetic timestamps anchored at `2026-05-17T14:00:00.000Z`.
- One scenario per file. Filename is the scenario in kebab-case.
- Scenarios are grouped by validation layer (`valid/`, `invalid-schema/`, `invalid-graph/`, `hash-mismatch/`, `reader-tolerant/`).
- Expected diagnostics are documented below. Tests in `packages/core/src/fixtures.test.ts` and `packages/cli/src/validate.test.ts` assert them.

## Loading

```ts
const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const loadFixture = (rel: string) => Bun.file(new URL(rel, FIXTURES)).text();
```

For CLI tests that need a real on-disk path:

```ts
import { fileURLToPath } from "node:url";
const path = fileURLToPath(new URL("valid/minimal-linear.trail.jsonl", FIXTURES));
```

## Scenarios

### valid/

#### `valid/minimal-linear.trail.jsonl`

Header + one `user_message` + one `agent_message`. No `parent_id`, no `content_hash`.

Expected: no diagnostics under either profile.

#### `valid/minimal-with-content-hash.trail.jsonl`

Same shape as `minimal-linear` with a precomputed `content_hash`:
`3936b470a29cb8e6814158eefb2d03871f4f96df480488b761b373b85ef594d2`.

If you edit any byte in this file, recompute the digest with `computeContentHash` (`packages/core/src/hash.ts`). One-liner from repo root:

```sh
bun -e 'import { computeContentHash } from "./packages/core/src/hash.ts"; import { parseJsonlString } from "./packages/core/src/jsonl.ts"; const text = await Bun.file("tests/fixtures/validation/valid/minimal-with-content-hash.trail.jsonl").text(); const records = await parseJsonlString(text); records[0].value.content_hash = "<pending>"; console.log(computeContentHash(records));'
```

Expected: no diagnostics under either profile.

#### `valid/linear-with-parent-ids.trail.jsonl`

Header + two events where the second event uses `parent_id` to reference the first.

Expected: no diagnostics under either profile.

#### `valid/streaming-open.trail.jsonl`

Header with `stream: { state: "open", started_at }`, no `content_hash`. Two events. Exercises the live-capture marker (§8.4).

Expected: no diagnostics under either profile.

#### `valid/streaming-finalized-clean.trail.jsonl`

Header with `stream: { state: "closed", started_at }`. Concludes with a `session_end` event (`reason: "complete"`).

Expected: no diagnostics under either profile.

#### `valid/tool-call-matched-by-for-id.trail.jsonl`

`tool_call` paired with `tool_result` via explicit `payload.for_id` reference (primary pairing method, spec §9.5).

Expected: no diagnostics under either profile.

#### `valid/tool-call-matched-by-semantic-call-id.trail.jsonl`

`tool_call` and `tool_result` both carry matching `semantic.call_id`; `tool_result` omits `for_id` (spec §9.5 fallback rule 1, semantic match).

Expected: no diagnostics under either profile.

#### `valid/tool-call-matched-sequentially.trail.jsonl`

`tool_call` followed by `tool_result`; neither carries `for_id` nor `semantic.call_id`. Paired by spec §9.5 fallback rule 2 (sequential match).

Expected: no diagnostics under either profile.

#### `valid/unmatched-tool-call-suppressed-by-session-end.trail.jsonl`

Open `tool_call` with no matching `tool_result`, followed by `session_end`. The clean-conclusion marker suppresses the `unmatched_tool_call_at_eof` warning (spec §9.3, §16.4).

Expected: no diagnostics under either profile.

#### `valid/unmatched-tool-call-suppressed-by-session-terminated.trail.jsonl`

Open `tool_call` with no matching `tool_result`, followed by `session_terminated` whose `payload.open_call_ids` lists the unmatched id. The escape hatch suppresses the warning (spec §16.4).

Expected: no diagnostics under either profile.

#### `valid/session-end-with-final-message-id.trail.jsonl`

`session_end.payload.final_message_id` references a real `agent_message` id in the same file (spec §9.3).

Expected: no diagnostics under either profile.

#### `valid/session-end-final-message-id-references-header.trail.jsonl`

`session_end.payload.final_message_id` references the session header `id`. The header counts as an in-file identifier for this check.

Expected: no diagnostics under either profile.

#### `valid/tool-result-for-id-targets-header-falls-through.trail.jsonl`

`tool_result.payload.for_id` references the session header `id` (not a `tool_call`). Spec §9.5 treats a `for_id` that doesn't resolve to a `tool_call` as missing, so pairing falls through to the semantic-match fallback. Both events share `semantic.call_id`, so they pair cleanly.

Expected: no diagnostics under either profile.

#### `valid/multiple-session-end-events.trail.jsonl`

Two `session_end` events follow an unmatched `tool_call`. Per spec §16.4, a `session_end` event anywhere in the file suppresses the `unmatched_tool_call_at_eof` warning; multiple terminators are tolerated.

Expected: no diagnostics under either profile.

#### `valid/agent-message-usage.trail.jsonl`

`agent_message` payload carries the full `usage` object (deltas, cumulative totals, cache read/creation, reasoning) per spec §9.2. Exercises that the schema accepts every documented sub-field and that the validator passes the cache-subset and presence rules.

Expected: no diagnostics under either profile.

### invalid-schema/

Current coverage targets `user_message` and `tool_call` payload violations. Additional event-type fixtures will be added as adapters and downstream issues require them.

#### `invalid-schema/header-wrong-schema-version.trail.jsonl`

Header carries `schema_version: "0.2.0"`.

Expected (strict, exact set):
- `error const /schema_version line 1` ("must be equal to constant")
- `error missing_header line 1` ("First line must be a session header ...") — emitted because the graph layer's header check fails when `schema_version !== "0.1.0"`.

#### `invalid-schema/user-message-missing-text.trail.jsonl`

`user_message` payload omits `text`.

Expected (strict): `error required /payload/text line 2`.

#### `invalid-schema/tool-call-missing-args-path.trail.jsonl`

`tool_call` payload's `args` object omits the required `path`.

Expected (strict): `error required /payload/args/path line 2`.

#### `invalid-schema/user-message-non-string-text.trail.jsonl`

`user_message` `payload.text` is a number.

Expected (strict): `error type /payload/text line 2`.

#### `invalid-schema/agent-message-usage-extra-field.trail.jsonl`

`agent_message.payload.usage` includes an unknown sub-field (`cost_usd`). The schema rejects unknown sub-fields via `additionalProperties: false`.

Expected (strict, subset): `error additionalProperties /payload/usage/cost_usd line 3`.

#### `invalid-schema/session-end-final-message-id-null.trail.jsonl`

`session_end.payload.final_message_id` is `null`. The schema requires a string id (`$defs/id`). The graph layer's `unknown_final_message_id` check skips non-string values, so only the schema error fires (and does not crash).

Expected (strict, subset): `error type /payload/final_message_id line 3`. No `unknown_final_message_id` warning.

### invalid-graph/

#### `invalid-graph/duplicate-id.trail.jsonl`

Two entries share `id: "evta1"`.

Expected: `error duplicate_id /id line 3` ("first seen on line 2").

#### `invalid-graph/unknown-parent-id.trail.jsonl`

Event references `parent_id: "ghost"` which is not present in the file.

Expected: `error unknown_parent_id /parent_id line 2`.

#### `invalid-graph/parent-cycle.trail.jsonl`

`node-a.parent_id = node-b` and `node-b.parent_id = node-a`.

Expected: `error parent_cycle /parent_id` on both lines 2 and 3.

#### `invalid-graph/stream-open-with-content-hash.trail.jsonl`

Header has `stream.state: "open"` and a populated `content_hash` (§16.4 rule 9). Two events follow. The hash is a placeholder and does not match the canonical bytes, so a `content_hash_mismatch` error also fires; the fixture asserts the warning surface, not strict equality.

Expected (subset, strict): single `warning stream_open_with_content_hash /content_hash line 1`.

#### `invalid-graph/unmatched-tool-call-at-eof.trail.jsonl`

Header + one `tool_call` with no matching `tool_result` and no terminal event. Triggers the spec §16.4 whole-file warning.

Expected (subset, both profiles): `warning unmatched_tool_call_at_eof /id line 2` ("tool_call \"evta1\" has no matching tool_result at EOF").

#### `invalid-graph/session-end-unknown-final-message-id.trail.jsonl`

`session_end.payload.final_message_id` references `"ghost"`, which is not present in the file.

Expected (subset, both profiles): `warning unknown_final_message_id /payload/final_message_id line 3`.

#### `invalid-graph/unmatched-tool-call-partial-suppression.trail.jsonl`

Two `tool_call` events open at EOF. A trailing `session_terminated.payload.open_call_ids` lists only the first id (`evta1`). Per spec §16.4, suppression applies per-id.

Expected (subset, both profiles): single `warning unmatched_tool_call_at_eof /id line 3` for `evta2` only.

#### `invalid-graph/unmatched-tool-call-session-terminated-without-open-call-ids.trail.jsonl`

`tool_call` open at EOF; trailing `session_terminated` carries no `open_call_ids`. Spec §16.4 only suppresses ids that are explicitly listed.

Expected (subset, both profiles): `warning unmatched_tool_call_at_eof /id line 2`.

#### `invalid-graph/tool-result-for-id-wins-over-semantic-conflict.trail.jsonl`

Two `tool_call` events: `evta1` (no semantic) and `evta2` (semantic `call_b`). A single `tool_result` carries both `for_id: "evta1"` and `semantic.call_id: "call_b"`. The explicit `for_id` wins per spec §9.5 (primary method), pairing the result with `evta1`. `evta2` is left unmatched with no suppression.

Expected (subset, both profiles): single `warning unmatched_tool_call_at_eof /id line 3` for `evta2`.

#### `invalid-graph/duplicate-tool-result-for-id.trail.jsonl`

Two `tool_call` events (`evta1`, `evta2`) and two `tool_result` events, both with `payload.for_id: "evta1"`. The second result's `for_id` resolves to an existing call, so per spec §9.5 it is consumed by the primary rule and does not fall through to the sequential fallback (which would otherwise wrongly pair it with `evta2`). `evta2` therefore stays unmatched.

Expected (subset, both profiles): single `warning unmatched_tool_call_at_eof /id line 3` for `evta2`.

#### `invalid-graph/session-end-forward-final-message-id.trail.jsonl`

`session_end` at line 2 references `final_message_id: "evta2"`, an event that appears at line 3 (after the terminator). Spec §16.4 says `final_message_id` should reference the session header or a *prior* event; forward references are flagged.

Expected (subset, both profiles): `warning unknown_final_message_id /payload/final_message_id line 2`.

#### `invalid-graph/agent-message-usage-missing-required.trail.jsonl`

`agent_message.payload.usage` is present but carries only `output_tokens`, missing both `input_tokens` and `input_tokens_cumulative`. Spec §9.2 requires at least one of each pair when `usage` is present.

Expected (subset, both profiles): `warning usage_missing_required /payload/usage line 3` for the missing input pair.

#### `invalid-graph/header-has-parent-id.trail.jsonl`

Header carries a `parent_id` field, which the spec forbids.

Expected (exact set):
- `error additionalProperties /parent_id line 1` — schema layer rejects unknown header property.
- `error header_has_parent_id /parent_id line 1` — graph layer rejects header-level parent_id.

### hash-mismatch/

#### `hash-mismatch/content-hash-mismatch.trail.jsonl`

Header `content_hash` is 64 zeros (schema-valid hex, wrong digest).

Expected (strict, exact set): single `error content_hash_mismatch /content_hash line 1`. Message includes the computed digest.

Expected (reader-tolerant, exact set): single `warning content_hash_mismatch /content_hash line 1` — severity downgraded from error to warning, message unchanged.

#### `hash-mismatch/content-hash-invalid-hex.trail.jsonl`

Header `content_hash` is a non-hex string.

Expected (exact set, identical for strict and reader-tolerant):
- `error pattern /content_hash line 1` — fails the `sha256Hex` pattern branch.
- `error const /content_hash line 1` — fails the `<pending>` const branch.
- `error oneOf /content_hash line 1` — composite oneOf failure.
- `error content_hash_invalid /content_hash line 1` — graph layer rejects non-hex digest.

### reader-tolerant/

Each fixture below produces at least one strict-profile error and a corresponding reader-tolerant warning. See the tests for full diagnostic shapes.

#### `reader-tolerant/patch-compatible-schema-version.trail.jsonl`

Header `schema_version: "0.1.1"` (a future patch release matching `^0\.1\.\d+$`).

- Strict: `error const /schema_version line 1`.
- Reader-tolerant: single `warning reader_tolerant_schema_version /schema_version line 1`.

#### `reader-tolerant/unknown-payload-field.trail.jsonl`

`user_message` payload carries an unknown `future_field`.

- Strict: `error additionalProperties /payload/future_field line 2`.
- Reader-tolerant: `warning reader_tolerant_unknown_payload_field /payload/future_field line 2`, no errors.

#### `reader-tolerant/nested-unknown-payload-field.trail.jsonl`

Unknown `future_field` nested inside `payload.attachments[0]`.

- Reader-tolerant: single `warning reader_tolerant_unknown_payload_field /payload/attachments/0/future_field line 2`.

#### `reader-tolerant/unknown-event-type.trail.jsonl`

Event with `type: "future_event"`, an event type not in the implemented set.

- Reader-tolerant: single `warning reader_tolerant_unknown_record /type line 2`.

#### `reader-tolerant/reserved-future-event-type.trail.jsonl`

Event with `type: "error"`, a reserved future event type.

- Reader-tolerant: single `warning reader_tolerant_unknown_record /type line 2`.
