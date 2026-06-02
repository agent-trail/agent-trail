# Context compaction replacement provenance

Agent Trail v0.1.0 has a first-class `context_compact` event, but its payload only recorded the
summary and optional token counts. Adapter audits for Codex, Pi, and Claude Code showed a shared
fidelity gap: source agents can identify which earlier conversation entries were folded, while the
format had no portable slot for that provenance.

## Decision

Add optional `context_compact.payload.replaced_message_ids: id[]` to `schema.json`.

The values are Agent Trail entry ids, not raw source ids. They are ordered by folded source order.
The field is provenance-only: writer-strict schema validation checks only the id shape, and
whole-file validation does not require each id to resolve to an entry still present in the same
trail file.

This lands in the current draft `schema_version: "0.1.0"` because v0.1.0 is not yet released as an
immutable public snapshot. No version bump is made.

## Adapter policy

- Pi compaction uses `CompactionEntry.firstKeptEntryId`: entries emitted from source records before
  that source id populate `replaced_message_ids`; empty or unresolved cases omit the field.
- Claude Code keeps `summary.isCompactSummary === true` as the canonical `context_compact` entry.
  A preceding `system.subtype === "compact_boundary"` marker supplies the folded emitted entry ids
  for the next compact summary when deterministic entry ids exist.
- Codex keeps an elided `compacted.replacement_history` marker under `source.raw` so raw trails
  record that folded history existed without inlining the folded transcript text. The adapter does
  not synthesize canonical `replaced_message_ids` for nested history items unless they can be
  mapped to emitted Agent Trail entry ids deterministically.

## Consequences

- `schema.json`, `packages/schema/schema.json`, and `packages/types/index.d.ts` include the optional
  field.
- Consumers can render or analyze compaction provenance when present without treating missing or
  dangling ids as invalid trail structure.
- Writers must omit the field rather than emitting raw source ids or empty arrays when provenance
  cannot be mapped to Agent Trail entry ids.

Tracks #176.
