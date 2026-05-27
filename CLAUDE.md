# Agent Trail — agent orientation

Open interchange format and tooling ecosystem for coding-agent sessions. Agent Trail is fully open source. It is not a hosted SaaS product; hosted products may use Agent Trail as a component. You're inside the repo. This file is the map.

## Read in this order

1. [`README.md`](./README.md) — repository overview and current status.
2. [`CONTEXT.md`](./CONTEXT.md) — project glossary. Use these terms in code, comments, commits, PRs, and issues.
3. [`spec.md`](./spec.md) — human-readable Agent Trail format specification. Current draft target: `0.1.0`.
4. [`schema.json`](./schema.json) — canonical writer-strict JSON Schema and machine-readable format contract through v1.0.
5. [`docs/PRD.md`](./docs/PRD.md) — product and implementation plan.
6. [`docs/adr/`](./docs/adr/) — durable architecture decisions. Do not relitigate without a superseding ADR.
7. [`LICENSES.md`](./LICENSES.md) — mixed-license layout.

When you need depth on a topic, follow the link instead of reading from memory. The above files are the source of truth; this file is a pointer.

## Stack

- Bun workspace monorepo.
- TypeScript, ESM-only packages.
- Library packages (`@agent-trail/schema`, `@agent-trail/types`, `@agent-trail/core`, `@agent-trail/redact`) support Node 20+ and Bun.
- `@agent-trail/cli` and adapter packages that compile into the CLI binary are Bun-only and use Bun-native APIs (see ADR-0003).
- Biome for linting/formatting.
- Lefthook for local pre-commit and pre-push checks.
- `@agent-trail/schema` publishes the schema artifact for npm consumers.
- `@agent-trail/types` contains committed TypeScript declarations generated from `schema.json`.

Workspace packages:

- [`packages/schema`](./packages/schema) — published JSON Schema package.
- [`packages/types`](./packages/types) — generated TypeScript types.
- [`packages/core`](./packages/core) — streaming JSONL parser, layered validation, hashing/canonicalization, multi-segment reconciler.
- [`packages/adapters`](./packages/adapters) — source-agent parsers; Pi and Claude Code verified, Codex CLI / Cursor / OpenCode / Aider pending.
- [`packages/redact`](./packages/redact) — share-time redaction pipeline.
- [`packages/store`](./packages/store) — content-addressed local object store and index; multi-segment reconciliation via `reconcileIncomingSegment`.
- [`packages/cli`](./packages/cli) — the `trail` binary: `validate`, `discover`, `list`, `share`, `load`, `export`.
- [`apps/website`](./apps/website) — website and web viewer app (scaffold).

## Load-bearing conventions

These are the ones agents are likely to get wrong. The full context lives in `CONTEXT.md`, `spec.md`, `docs/PRD.md`, and ADRs. Read those before disagreeing.

- **`schema.json` is the canonical format contract.** Generated TypeScript types, validators, docs, package exports, and tests derive from it. Do not make TypeScript the source of truth.
- **Spec scope ends at the trail file.** CLI verbs, store layout, adapter API types (`SessionRef`, `DetectOptions`), discovery affordances, and `trail discover --json` output shape are implementation details of `@agent-trail/cli` and `@agent-trail/adapters`. Other implementations can ship completely different tooling and remain spec-compliant as long as the trail files they emit pass `schema.json`. Do not add tool-runtime types to `schema.json`.
- **Spec version and package versions are separate.** The current format target is `0.1.0`. npm packages use independent SemVer and declare supported spec versions when implemented.
- **Root contract files stay visible.** Keep `spec.md` and `schema.json` at the repo root. Product planning lives under `docs/`.
- **Local filenames are unversioned.** Public hosted spec/schema URLs are immutable versioned snapshots, such as `/spec/v0.1.0` and `/schema/v0.1.0.json`, plus latest aliases.
- **Raw and redacted trails are separate artifacts.** A redacted trail is produced from a raw trail. A shared trail transports a redacted trail.
- **`content_hash` identifies exact artifact bytes.** Do not redefine it as a semantic session ID or resolver key.
- **V1 sharing uses gist-locating viewer URLs.** Do not introduce hash resolver URLs unless a later decision changes the product shape.
- **Validation is layered.** JSON Schema validates individual records; whole-file validation checks graph and file-level rules; hash verification is a separate strict check; reader-tolerant parsing is not writer-strict validation.
- **`parent_id` is tree topology only.** Do not overload it for tool-call linking or semantic references.
- **Mandatory event set is narrow.** Phase 1 core rendering targets user messages, agent messages, tool calls, tool results, and summaries, with fallback rendering for unknown records.
- **MCP is deferred.** Do not add MCP package behavior unless the active issue explicitly asks for it.
- **Committed fixtures must be synthetic or redacted.** Real local sessions stay out of git and are only used by opt-in ignored tests.
- **Stop before changing load-bearing shape.** Schema semantics, validation terminology, hash semantics, artifact identity, package layout, and public URL shape need an issue/ADR-level decision before implementation.

## Verify

Run the strongest relevant check for the change:

- `bun run check` — full local gate: schema-sync drift, generated-type drift, typecheck, Biome, tests, workspace checks.
- `bun run check:schema` — verifies `packages/schema/schema.json` mirrors the canonical root `schema.json`.
- `bun run check:types` — generated TypeScript type drift check.
- `bun run sync:schema` — after editing the root `schema.json`; copies it to `packages/schema/schema.json` and you commit the diff.
- `bun run generate:types` — after editing `schema.json`; then commit the generated `packages/types/index.d.ts` diff.
- `bun run typecheck`
- `bun run lint`
- `bun run lint:fix`
- `bun run test`
- `jq empty schema.json` — after editing the schema.

"Done" means exit code 0. Not "I think it works."

## Where things live

| You need | Look at |
|---|---|
| Format rules | [`spec.md`](./spec.md) |
| Machine-readable format contract | [`schema.json`](./schema.json) |
| Project glossary | [`CONTEXT.md`](./CONTEXT.md) |
| Product plan and roadmap | [`docs/PRD.md`](./docs/PRD.md) |
| Architecture decisions | [`docs/adr/`](./docs/adr/) |
| License policy | [`LICENSES.md`](./LICENSES.md) |
| Schema package exports | [`packages/schema/package.json`](./packages/schema/package.json) |
| Schema package tests | [`packages/schema/schema.test.ts`](./packages/schema/schema.test.ts) |
| Generated TypeScript types | [`packages/types/index.d.ts`](./packages/types/index.d.ts) |
| Type generation script | [`scripts/generate-types.ts`](./scripts/generate-types.ts) |
| CI checks | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) |
| Local hooks | [`lefthook.yml`](./lefthook.yml) |
| Validation fixtures | [`tests/fixtures/validation/`](./tests/fixtures/validation/) (see [`README.md`](./tests/fixtures/validation/README.md)) |
| Parser source matrix | [`docs/parser-source-matrix.md`](./docs/parser-source-matrix.md) |

## Quick rules for PRs

- Always work on a feature branch and open a PR. Never push directly to `main`.
- Squash merge only. Delete branch after merge.
- Required CI check: `typecheck + lint + test`.
- Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `ci:`). Reference issues with `closes #N` when applicable.
- No Claude / agent attribution in commits, PR bodies, generated docs, or code comments. Author is the human.
- Keep issue slices narrow. Do not add Phase 2+ surfaces unless the active issue explicitly asks for them.

## Compaction

When compacting, preserve: modified file paths, issue/PR numbers, verification commands with results, and ADR numbers or spec sections referenced by changed code.
