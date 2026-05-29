# @agent-trail/source-schemas

Bundled JSON Schemas describing upstream coding-agent source formats. Consumed by
[`@agent-trail/adapter-kit`](../adapter-kit) (`selectSchemaVersion`, `validateSourceRecord`) to
quarantine records that drift from a known shape before they reach the trail mapper.

These schemas describe the **raw upstream files** (codex rollout JSONL, claude-code session JSONL,
etc.) — not the trail format. The trail format contract lives in the root
[`schema.json`](../../schema.json) / [`@agent-trail/schema`](../schema).

## Layout

```text
codex/
  meta.json       — agent metadata + version → schema mapping
  v0.128.json     — JSON Schema (draft 2020-12) for v0.128.x records
  v0.128.d.ts     — generated TypeScript types (do not edit)
pi/
  meta.json
  v1.json
  v1.d.ts
claude-code/
  meta.json
  v1.json
  v1.d.ts
```

Each schema validates one record (one JSONL line). Validation is intentionally lenient on additive
field drift and strict on record-type drift — a brand-new top-level `type` or `event_msg` subtype
fails validation and is quarantined.

## `meta.json` shape

```json
{
  "agent": "codex",
  "upstream": "openai/codex",
  "version_ranges": [
    { "schemaVersion": "v0.128", "range": ">=0.128.0 <0.129.0" }
  ],
  "fallback": "v0.128"
}
```

| Field | Purpose |
|---|---|
| `agent` | Stable agent identifier. Matches the `agent` argument to `selectSchemaVersion` / `validateSourceRecord`. |
| `upstream` | Informational reference to the source repo or project. Not used at runtime. |
| `version_ranges` | Ordered list of semver-range → schema-version mappings. First match wins. |
| `fallback` | Schema version used when an upstream version is provided but matches no range. Omit to refuse fallback. |

## Adding a new agent / version

1. Add the agent directory and write `meta.json` + `vX.json` (JSON Schema 2020-12, `$id` set to
   `https://agent-trail.dev/source/<agent>/<version>.json`).
2. Register the new exports in this package's [`package.json`](./package.json) under `exports`.
3. Run `bun run generate:source-types` from the repo root to regenerate `.d.ts` files.
4. Register the schema in
   [`packages/adapter-kit/src/source-schemas/registry.ts`](../adapter-kit/src/source-schemas/registry.ts).
5. `bun run check:source-types` verifies generated types are not stale.
