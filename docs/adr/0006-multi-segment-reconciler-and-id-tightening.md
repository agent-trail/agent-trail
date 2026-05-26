# Multi-segment reconciler, adapter `session_uid` emission, and tightened event `id` regex

Issue #73 left three follow-ups open after ADR-0005 landed the spec primitives:

1. A library API that performs the 6-step reconciliation algorithm from spec §8.5.
2. Adapter emission of `session_uid` so the v0.1 corpus carries real coverage rather than relying on synthetic fixtures.
3. Tightening the event `id` regex so the reconciler can dedup by string equality without trusting a writer-side MUST.

This ADR records the implementation choices for those follow-ups.

## Reconciler API

`packages/core/src/reconcile.ts` exports `reconcileSegments(inputs: SegmentInput[]): ReconcileResult`. Inputs are parsed segment trails labelled by an opaque `source` string (typically a file path or store key). The algorithm:

1. Groups inputs by `header.session_uid`. Inputs without `session_uid` become pass-through singletons; an input with `segment.seq >= 2` but no `session_uid` emits a result-level `missing_session_uid` warning.
2. Sorts each group by `segment.seq` (segments without `segment` count as `seq=1`).
3. Verifies the `prev_content_hash` chain on each non-first segment. Mismatch → `segment_chain_mismatch` warning. `null` prev hash or absent prior `content_hash` → `segment_chain_unverifiable`. Both keep the merge running.
4. Concatenates events. Deduplicates by event `id` (set membership). Counts duplicates in `events_deduped`.
5. Drops intermediate `session_terminated{reason: "process_terminated"}` markers — those are crash records from killed writers; only the final terminator is kept.
6. Builds one merged header per spec §8.5 step 6: `ts` from the lowest-seq segment (real session start), late-binding fields (`stream`, `content_hash`, `vcs`, `cwd`, `meta`) from the highest-seq segment (latest state), stable fields (`id`, `type`, `schema_version`, `session_uid`) preferring the first header and warning on divergence. Header fields not enumerated by the spec late-bind by default via the `lastHeader` spread, which keeps schema growth additive. `segment.*` is dropped.
7. Re-stamps `content_hash` on the merged trail via `stampTrail` so the produced bytes validate as a finalized artifact.

Warnings carry a `source` label and a `code` from a closed enum (`segment_chain_mismatch`, `segment_chain_unverifiable`, `segment_seq_gap`, `segment_seq_duplicate`, `stable_field_divergence`, `missing_session_uid`, `missing_session_header`). Eight tracer-bullet tests in `packages/core/src/reconcile.test.ts` cover the algorithm.

**`agent.name` sub-field caveat.** Spec §8.5 step 6 lists `agent.name` as stable, but the reconciler protects `agent.*` as a whole object and inherits it from the highest-seq segment (late-binding of the parent object). In practice `agent.name` does not change mid-session for any v0.1 writer, so the divergence is theoretical. If a future writer needs sub-field stable-vs-late-binding distinctions, the reconciler will need a per-path policy rather than the current top-level field policy; this is deferred to a follow-up.

## `trail load` integration

`packages/cli/src/load.ts` now peeks at the incoming trail's `session_uid` and queries the store for prior entries via a new `findEntriesBySessionUid` helper on `@agent-trail/store`. When matches are found, the incoming trail is reconciled against them in-memory before registration, the merged trail is registered (its own fresh `content_hash`), and a summary line is appended to stdout:

```text
Reconciled: 2 segments merged, 1 events deduped, 0 warnings (session_uid <uid>)
```

Per-warning lines follow the summary so chain mismatches are visible at load time.

The store index entry now carries `session_uid: string | null` so the lookup is index-driven, not a full-store scan. `rebuildIndex` populates the field from on-disk objects, so older stores recover the field on the next rebuild.

## Adapter emission

Both bundled adapters now emit `session_uid: crypto.randomUUID()` on the session header (`packages/adapters/src/{claude-code,pi}/parser.ts`). This is the simplest correct emission: each adapter run produces a fresh uid, so reconciliation only kicks in when a continuation segment is captured later (per spec §8.5 writers SHOULD reuse the uid across segments). Future adapter work that knows the upstream session id is stable across resumes can derive a deterministic uid instead; this PR does not bake that knowledge in.

## Event `id` regex tightening

`$defs/id` in `schema.json` now `$ref`s `$defs/sessionUid`: 26-char Crockford ULID (case-insensitive), 36-char hyphenated UUID, or 32-char unhyphenated UUID. Consequences:

- `blockId` in both adapters (`claude-code/entry-metadata.ts`, `pi/entry-metadata.ts`) mints a fresh `crypto.randomUUID()` per block when an envelope produces multiple events; the source uuid and per-block index remain on `source.raw` for traceability.
- `cryptoRandomShort` in `pi/parser.ts` and the synthesized `model_change` id in `claude-code/parser.ts` switch from compound strings to full `crypto.randomUUID()` calls.
- `synthesizeInterrupt` in `pi/envelope-mappers.ts` does the same for aborted-assistant interrupts.
- Test fixtures and inline test data that previously used short synthetic ids (`sess-old`, `evtbeat`, `u-mc-1`, …) were rewritten to ULIDs or hashed UUIDs.

Specific id assertions that previously depended on compound block ids (e.g., `a-1-text-0`) were converted to type/parent-chain checks, since multi-block envelopes now produce non-deterministic ids at runtime. `semantic.call_id` and `source.raw.envelope_ref` remain stable across runs and serve as the new join keys in tests.

## Considered alternatives

- **Validator warning instead of regex tightening** — rejected. The reconciler runs against arbitrary writer output; a soft warning is not enough to make string-equality dedup safe.
- **Deterministic adapter `session_uid` from upstream session id** — deferred. Real-world session ids would need a stable namespacing scheme to avoid collisions across machines; not a v0.1 concern.
- **Separate `reconcile` CLI verb** — rejected. `trail load` is the natural entry point because the store already tracks the prior segments; a new verb would duplicate that lookup.

## Consequences

- `schema.json`, `packages/schema/schema.json`, and `packages/types/index.d.ts` regenerated against the tightened `id` regex.
- Adapter test fixtures (cc + pi inline JSONL and assertions) rewritten to use UUIDs.
- Validation fixtures touched in the prior PR plus new ones (e.g., reconciler tests' inline trails) keep the existing ULID scheme.
- Store schema unchanged on disk except for the new optional `session_uid` field on each entry; older entries continue to validate (the field is optional).

Closes the remaining #73 follow-ups.
