# Agent Trail Implementation Semantics

This document is non-normative. It explains how Agent Trail tooling in this
repository maps, reconciles, validates, renders, and redacts trail files.

The normative contract remains `schema.json` plus `spec.md`. A trail file is
valid or invalid only by that contract. Guidance here can inform adapters,
viewers, validators, redactors, and CLI behavior, but it cannot make a trail
valid or invalid by itself.

## Boundary

Use this split:

- `schema.json` and `spec.md`: wire shape, field meanings, versioning,
  extension rules, hashing, and whole-file validity.
- This document: implementation choices, mapping policy, reader behavior,
  warning codes, redaction workflow, and promotion guidance.
- `docs/parser-source-matrix.md`: verified source-agent formats, versions,
  fixtures, and per-adapter evidence.
- `docs/adapter-authoring.md`: checklist for building or updating adapters.
- ADRs: durable decisions and historical rationale.

If a rule affects whether an emitted trail is writer-strict valid, it belongs
in the spec or schema. If it explains how one implementation should produce,
consume, or display otherwise-valid trails, it belongs here or in package docs.

## Adapter Semantics

Adapters convert source-agent storage into the Agent Trail wire format. They
should map only facts present in source data, and use `source.synthesized: true`
when no single source record directly produced an entry.

### Source Mapping

Prefer first-class Agent Trail events when semantics match:

- `user_message` and `agent_message` for transcript text.
- `agent_thinking` for reasoning content that source exposes.
- `context_compact` for compaction summaries.
- `tool_call`, `tool_result`, and `tool_call_aborted` for tool lifecycles.
- `task_plan_update` for structured todo/plan snapshots.
- `model_change`, `mode_change`, `thinking_level_change`,
  `capability_change`, `command_invoke`, `session_metadata_update`, or
  `system_event` for matching source signals.

Use vendor `system_event.payload.kind` values for weak-fit source events, for
example `x-<adapter>/<event>`. Preserve source details in `source.raw` or
vendor `meta` rather than extending the top-level event vocabulary.

### Parent Topology And Branching

`parent_id` is event graph topology. It is neither ordinary linear sequencing
nor tool-call/result linking.

Adapter policy:

- Tree-native sources may emit `parent_id` for entries where source topology is
  known.
- Linear sources should usually omit `parent_id`; file order is enough.
- Inline subagent events can use the parent `subagent_invoke` entry as their
  root parent.
- External subagents or forked transcripts should become separate session
  groups or external trails linked by `header.fork_from`.
- Source runtime ids that are not Agent Trail entry or session ids should stay
  in `source.raw`, `semantic`, or `meta`.

Tree-aware readers may choose an active path for display, but that is a viewer
policy. The wire format has only an acyclic per-group `parent_id` graph.

### Tool Mapping

Known source tools should map to canonical `tool_call.payload.tool` values and
the corresponding argument shape. Unknown tools should use
`tool: "other"` with `args: { name, args }`.

When a source exposes native call ids, adapters should populate
`semantic.call_id` on calls and results. Populate `payload.for_id` when the
matching Agent Trail `tool_call.id` is known. Do not emit fake `tool_result`
records for calls that never completed; use `tool_call_aborted` or
`session_terminated` when source evidence says the call did not finish.

### Source Raw And Envelope References

`source.raw` is the escape hatch for source fidelity. It should be redacted and
size-limited before emission.

When one source envelope fans out to multiple Agent Trail entries, adapters can
use inline-first / ref-subsequent preservation:

- First derived entry stores the source envelope in `source.raw.envelope`.
- Later derived entries store `source.raw.envelope_ref` pointing to the first
  entry id.
- Block-level data can stay on each derived entry as `source.raw.block` and
  `source.raw.block_index`.

This keeps entries self-describing while avoiding repeated large source
envelopes.

Envelope-level `payload.usage` follows the same first-derived-entry convention:
attach it once to the first derived entry whose payload supports usage, and do
not repeat it on later entries from the same source envelope.

### Session UID

Adapters should emit stable `session_uid` values when they can identify the
same logical source session across parses or segments. The bundled adapters use
deterministic UUIDv5 derivation from upstream session ids with per-adapter
namespaces, so re-parsing a source session is idempotent. That derivation is
implementation policy, not wire-format requirement.

## Reader And Viewer Semantics

Readers should validate before rendering when possible, but generic rendering
should remain useful for partial or future-compatible files.

Linear-only viewers can:

- Render entries in file order.
- Show `branch_summary` entries as inline callouts.
- Warn when `parent_id` topology exists but the viewer cannot render it fully.

Tree-aware viewers can:

- Build the per-group parent graph.
- Let users choose a displayed path or branch.
- Render branch summaries and abandoned paths as UI affordances.

These display choices do not affect trail validity.

## Reconciliation Semantics

Multi-segment fields in the spec provide enough information to group, order,
and verify segments. This repository's reconciler applies this policy:

1. Group inputs by `header.session_uid` using exact string equality. Do not
   compare these fields case-insensitively or normalize them to lowercase;
   casing disagreement is a writer-side bug that should be surfaced.
2. Sort each group by `segment.seq`; absent segment means sequence 1.
3. Verify `segment.prev_content_hash` against the previous segment's
   session-level `content_hash` using exact string comparison. Do not compare
   content hashes case-insensitively; `content_hash` is lowercase hex, and
   casing disagreement is a writer-side bug that should be surfaced.
4. Concatenate events and deduplicate by event `id`.
5. Drop intermediate `session_terminated` entries whose reason is
   `process_terminated`.
6. Build one merged header:
   - session start fields from the lowest sequence segment;
   - late-binding fields such as `stream`, `content_hash`, `vcs`, `cwd`, and
     `meta` from the highest sequence segment;
   - stable fields such as `id`, `schema_version`, `agent.name`, and
     `session_uid` checked for divergence.
7. Drop `segment.*` fields from the merged header and restamp hashes.

Warning codes and exact merge diagnostics are implementation API details. ADRs
0005 and 0006 record the design history.

## Validation Diagnostics

The spec defines the portable diagnostic shape: `line`, `path`, `severity`,
`code`, and `message`.

The reference validator uses stable codes for tooling and tests, including
graph, envelope, hash, segment, source-raw, and stream-state diagnostics. These
codes are implementation surface for `@agent-trail/core`; adding a new code does
not change the wire format unless the underlying validity rule changes.

Validators may also report implementation-defined warnings, such as source raw
size budgets or leak scans. Such warnings should not be described as spec
errors unless the spec defines the failing condition.

## Redaction And Sharing Semantics

Raw trails preserve source fidelity. Redacted trails are separate artifacts,
usually produced before sharing. Shared trails are redacted trails transported
through a product or tool-specific mechanism.

This repository's redaction policy is:

- Adapter emission should clean known secret patterns in `source.raw`.
- Share-time redaction should scan messages, tool outputs, structured
  `tool_result.payload.meta`, attachments metadata, paths, private remotes, and
  source raw.
- Redaction mutates records, then hashes must be restamped.
- Changed event entries should increment `entry.meta.redaction_count`.
- `vcs.remote_url` should be stripped or normalized in shared artifacts unless
  the user opts in.

Exact patterns, thresholds, previews, and upload behavior belong to
`@agent-trail/redact`, `@agent-trail/cli`, and product documentation.

## Promotion Process

Implementation semantics can graduate into the format contract when at least
one of these is true:

- Multiple independent adapters need the same field or event semantics.
- Readers cannot interoperate without a shared rule.
- A current implementation warning should become writer-strict validity.
- A vendor extension has proven cross-agent value.

Promotion requires updating `schema.json` when wire shape changes, updating
`spec.md`, regenerating derived types when needed, and documenting compatibility
impact. Adapter-specific evidence stays in `docs/parser-source-matrix.md`.
