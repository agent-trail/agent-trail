# Use a single Bun monorepo

Agent Trail keeps the spec, schema, generated types, validation core, adapters, CLI, redaction package, and website in one Bun-based open-source monorepo. This keeps pre-1.0 schema changes, generated artifacts, fixtures, validators, and package behavior reviewable in one change instead of splitting the format contract from the tooling that proves it.

**Considered Options**

- Single Bun monorepo for spec and tooling.
- Separate spec repository plus separate implementation repository.
- Publish only the spec first and create tooling repositories later.

**Consequences**

- Root contract files stay stable as `spec.md` and `schema.json`; product planning lives in `docs/PRD.md`.
- Published JavaScript packages are ESM-only, support Node 20+ and Bun, and version independently from the spec while declaring supported spec versions.
