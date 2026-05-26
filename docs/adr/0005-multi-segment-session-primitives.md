# Multi-segment session primitives

The session header carries three optional fields that let a reconciler group, order, and verify trail-file segments belonging to one logical source session:

- `session_uid` — globally-unique source-session identifier, stable across all segments.
- `segment.seq` — 1-based integer; absent or `{seq: 1}` for single-segment trails.
- `segment.prev_content_hash` — sha256 of the previous segment's session-level `content_hash`. Required when `seq >= 2`. Forms a verifiable chain (HLS / Postgres-WAL pattern). `null` is allowed when the prior segment was lost; readers warn but continue.

The primitives sit at **session-header grain** so they compose cleanly with the deferred multi-session trail (#91), where each session in a file may independently be multi-segmentable. The trail envelope (#90, ADR-0004) is unaffected.

`session_uid` accepts ULID or UUID (hyphenated or unhyphenated). ULID is recommended because the time-prefix gives a useful secondary sort when `segment.seq` is missing or ambiguous, but real-world adapters (claude-code, codex) emit UUIDs from upstream session metadata so both are accepted.

The schema-level event `id` regex is **not** tightened in this change. Globally-unique event ids would let a reconciler dedup by string equality, but tightening the regex cascaded into adapter compound-id breakage (`uuid-tool_use-1` shapes, `pi-eof-<short>` synth ids, multi-block block ids). The cost was disproportionate to the v0.1 reconciliation value: reconciliation is not implemented in core in this slice (it is the follow-up PR), and a future tightening can land alongside the reconciler when adapter migration costs can be paid in the same change. For now, event `id` keeps the prior `minLength: 4` schema constraint and spec §9 documents the recommendation that writers MUST emit globally-unique event ids when their output is intended for reconciliation.

**Considered Options**

- **Cursor pattern (SSE / AT Protocol firehose)**: per-event monotonic int + session uuid. Rejected for v0.1 — the trail already content-addresses events and has a `parent_id` DAG, so per-event sequencing is redundant.
- **Tuple position (Kafka / Kinesis / Postgres WAL)**: session + shard + per-shard seq. Rejected — Agent Trail is single-producer per session; multi-shard adds complexity without payoff.
- **Idempotent event id pattern (CRDT / Sentry / Atom paged)**: globally-unique event id + optional causal DAG + chain hash. Adopted, restricted to header-level primitives (`session_uid` + `segment.seq` + `prev_content_hash`); event-id tightening deferred.

**Consequences**

- `schema.json` adds `$defs/ulid` (strict ULID regex) and `$defs/sessionUid` (ULID-or-UUID union), and `$defs/segment` with a `oneOf` branching on `seq == 1` vs `seq >= 2 with prev_content_hash`.
- The header schema admits optional `session_uid` and `segment` properties; existing single-segment trails remain valid without either.
- The graph validator is unchanged in this slice. Reconciliation is a separate library API and CLI behaviour to land alongside #84-style follow-ups.
- Existing adapter parsers and graph rules are unaffected; the new fields are inert until consumers opt in.
- Spec §8.5 documents the primitives and the 6-step reconciliation algorithm.
- Deferred to follow-up: `reconcileSegments` API in `@agent-trail/core`, `trail load` reconciliation integration, daemon `.cursor.json` sidecar, multi-shard/parallel-producer extensions, tightening of event `id` to a strict ULID-or-UUID union.

**Bootstrap risk**: Spec §8.5 says writers SHOULD emit `session_uid` even for single-segment trails, but the claude-code and pi adapters in this PR were intentionally not updated to emit it (the session_uid-required attempt cascaded into broader adapter rework — see "Considered Options" above). Consequence: the v0.1 trail corpus has zero real-world `session_uid` coverage until adapters are updated. The reconciler follow-up PR MUST land adapter `session_uid` emission alongside the library, or reconciliation will only work on synthetic fixtures.

Note that for the **multi-segment** case (`segment.seq >= 2`), the schema now enforces `session_uid` as required via an `if/then` block on the header. This closes the documented gap for continuation segments without requiring single-segment adapters to emit `session_uid`. v0.1 ships no real multi-segment writers, so this enforcement bites only synthetic fixtures and any future writer that opts into multi-segment emission.

**Event-id uniqueness gap**: Spec §8.5 step 4 says writers MUST emit globally-unique event ids if their output is intended for reconciliation, but the schema only enforces `minLength: 4`. This is a writer-side contract with no validator enforcement in v0.1. The reconciler follow-up PR is expected to close the gap with a `event_id_not_globally_unique` validator warning and/or a tighter event-id regex bundled with the adapter id-format migration.

Tracks #73 spec contract. Reconciler implementation and `trail load` integration land in a follow-up issue.
