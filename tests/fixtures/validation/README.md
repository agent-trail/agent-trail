# Validation fixtures

Committed synthetic trail files exercising the Agent Trail validation paths. All fixtures are reusable across `@agent-trail/core`, `@agent-trail/cli`, and future adapter tests.

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

If you edit any byte in this file, recompute the digest with `computeContentHash` (`packages/core/src/hash.ts`).

Expected: no diagnostics under either profile.

#### `valid/linear-with-parent-ids.trail.jsonl`

Header + two events where the second event uses `parent_id` to reference the first.

Expected: no diagnostics under either profile.

### invalid-schema/

#### `invalid-schema/header-wrong-schema-version.trail.jsonl`

Header carries `schema_version: "0.2.0"`.

Expected (strict): `error const /schema_version line 1`. The graph layer also emits `error missing_header line 1` because the header fails the `schema_version === "0.1.0"` check.

#### `invalid-schema/user-message-missing-text.trail.jsonl`

`user_message` payload omits `text`.

Expected (strict): `error required /payload/text line 2`.

#### `invalid-schema/tool-call-missing-args-path.trail.jsonl`

`tool_call` payload's `args` object omits the required `path`.

Expected (strict): `error required /payload/args/path line 2`.

#### `invalid-schema/user-message-non-string-text.trail.jsonl`

`user_message` `payload.text` is a number.

Expected (strict): `error type /payload/text line 2`.

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

#### `invalid-graph/header-has-parent-id.trail.jsonl`

Header carries a `parent_id` field, which the spec forbids.

Expected: `error header_has_parent_id /parent_id line 1`. The schema layer also reports `additionalProperties /parent_id line 1` — both diagnostics are emitted.

### hash-mismatch/

#### `hash-mismatch/content-hash-mismatch.trail.jsonl`

Header `content_hash` is 64 zeros (schema-valid hex, wrong digest).

Expected (strict): `error content_hash_mismatch /content_hash line 1`. Under reader-tolerant the same diagnostic downgrades to `warning`.

#### `hash-mismatch/content-hash-invalid-hex.trail.jsonl`

Header `content_hash` is a non-hex string.

Expected: `error content_hash_invalid /content_hash line 1`. The schema layer additionally emits `oneOf /content_hash` since the value fails the `sha256Hex` pattern.

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
