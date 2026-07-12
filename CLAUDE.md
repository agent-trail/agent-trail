# Agent Trail repository instructions

Agent Trail is an open interchange format and tooling ecosystem for coding-agent sessions. It is fully open source and is not a hosted SaaS product; hosted products may use it as a component.

The repository is a Bun workspace monorepo with ESM-only TypeScript packages. Public library packages support Node 20+ and Bun; the CLI and compiled adapter surface are Bun-only. A small Go toolchain surface verifies cross-language hash vectors.

## Architecture and ownership

| Area | Owns | Entry points |
|---|---|---|
| Format contract | Human-readable specification and canonical writer-strict schema | `spec.md`, `schema.json` |
| Schema package | Published schema mirror and conformance corpus | `packages/schema/` |
| Generated types | Committed declarations derived from `schema.json` | `packages/types/index.d.ts`, `scripts/generate-types.ts` |
| Core | Streaming JSONL parsing, layered validation, hashing, canonicalization, reconciliation | `packages/core/` |
| Adapters | Source-agent parsers | `packages/adapters/` |
| Redaction and store | Share-time redaction and content-addressed local storage | `packages/redact/`, `packages/store/` |
| CLI | `trail validate`, discovery, listing, sharing, loading, and export | `packages/cli/` |
| Website | Website and web viewer | `apps/website/` |

`schema.json` is the canonical format contract through v1.0. Generated types, validators, docs, package exports, and tests derive from it; TypeScript is not the source of truth.

## Setup and verification

Run `bun install` in a repository worktree. The package prepare script runs `bun run worktree:setup`; do not install Lefthook manually in worktrees. Development checks require Bun 1.3.11+ and Go matching `go.mod` for hash-vector tooling.

| Changed surface | Focused command |
|---|---|
| Any completed change | `bun run check` |
| Root `schema.json` | `jq empty schema.json`, `bun run sync:schema`, `bun run generate:types`, `bun run check:schema`, `bun run check:types` |
| Conformance fixtures | `bun run check:conformance` |
| Generated source types | `bun run generate:source-types`, then the relevant drift check |
| Redaction documentation | `bun run generate:redaction-docs`, then `bun run check:redaction-docs` |
| TypeScript behavior | `bun run typecheck`, `bun run lint`, `bun run test` |
| Worktree lifecycle | `bun run worktree:doctor` at the start and end |

`bun run check` is the full local gate: schema and generated drift checks, conformance and hash vectors, typecheck, Biome, tests, dependency resolution, and workspace checks. Done means exit code 0.

This repository does not use mise as its command source; use `package.json`, Bun scripts, and `go.mod`.

Treat the command, worktree, and pull request rules in this file as canonical for task planning. Do not reopen `package.json`, `.github/PULL_REQUEST_TEMPLATE.md`, or `docs/worktree-workflow.md` solely to confirm facts already stated here; inspect them when changing those contracts or when execution details not covered here are required.

## Task-triggered references

Do not read every repository document at startup. Open only the references required by the task.

| Task | Read |
|---|---|
| Format record shape, required fields, or normative semantics | `spec.md`, `schema.json` |
| Project terminology | `CONTEXT.md` |
| Product scope or roadmap | `docs/PRD.md` |
| Validation, adapters, reconciliation, or redaction implementation semantics | `docs/implementation-semantics.md` |
| Existing architecture decision | Relevant file under `docs/adr/` |
| Parser support or a new adapter | `docs/parser-source-matrix.md`, `docs/adapter-authoring.md` |
| Worktree creation, sync, or cleanup | `docs/worktree-workflow.md` |
| License boundary | `LICENSES.md` |
| Contribution or RFC process | `CONTRIBUTING.md` |

## Generated and sensitive content

- After editing root `schema.json`, run `bun run sync:schema` and commit the resulting `packages/schema/schema.json` diff.
- Run `bun run generate:types` and commit the generated `packages/types/index.d.ts` diff after schema changes.
- Committed fixtures must be synthetic or redacted. Real local sessions remain ignored and may be used only by opt-in local tests.
- Raw and redacted trails are separate artifacts; a shared trail transports a redacted trail.

## Load-bearing format rules

- Spec scope ends at the trail file. CLI verbs, store layout, adapter API types, and discovery output are implementation details and do not belong in `schema.json`.
- Spec version and npm package versions are independent.
- Keep `spec.md` and `schema.json` at the repository root; local filenames remain unversioned while hosted snapshots use immutable versioned URLs.
- `content_hash` identifies exact artifact bytes, not semantic session identity.
- V1 sharing uses gist-locating viewer URLs; do not introduce hash-resolver URLs without a later product decision.
- Validation remains layered: per-record JSON Schema, whole-file graph checks, strict hash verification, and separate reader-tolerant behavior.
- `parent_id` represents tree topology only.
- Keep the mandatory event set narrow: user messages, agent messages, tool calls, tool results, summaries, and fallback rendering for unknown records.
- MCP is deferred unless the active issue explicitly requests it.
- Schema semantics, validation terminology, hash semantics, artifact identity, package layout, and public URL shape require an issue or ADR-level decision before implementation.

## Worktrees and external cleanup

- Keep `main` clean and use one feature-branch worktree per issue or PR.
- Run `bun run worktree:doctor` at the start and end.
- `bun run worktree:cleanup` is dry-run by default. After merge or closure, inspect it before running `bun run worktree:cleanup -- --apply`.
- Cleanup removes only clean linked worktrees for merged or closed PRs; it preserves open PR worktrees.

## Pull requests and completion evidence

- Work on a feature branch and open a PR; never push directly to `main`.
- Use `.github/PULL_REQUEST_TEMPLATE.md`. Link the issue, summarize implementation, state public API/schema/spec impact, record risk and rollback, exact verification, and reviewer focus.
- Use conventional commits. The PR title is the final squash commit subject; squash merge and delete the branch after merge.
- Required CI check: `typecheck + lint + test`.
- Keep issue slices narrow and do not add later-phase surfaces unless requested.
- Preserve modified paths, issue or PR numbers, verification results, and referenced ADR or spec sections in handoffs.
