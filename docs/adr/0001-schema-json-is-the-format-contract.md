# schema.json is the format contract

Agent Trail is a language-neutral interchange format, so `schema.json` is the canonical machine-readable contract through v1.0. TypeScript types, validators, and package exports derive from the schema rather than becoming a separate source of truth, which keeps non-TypeScript adopters from depending on implementation internals.

**Considered Options**

- Keep `schema.json` canonical and generate implementation artifacts from it.
- Make TypeScript types canonical and generate `schema.json`.
- Maintain schema and TypeScript types separately with parity tests.

**Consequences**

- Generated TypeScript types are committed so schema changes produce reviewable diffs.
- `@agent-trail/schema` publishes the schema for npm consumers while hosted schema URLs remain immutable release snapshots.
