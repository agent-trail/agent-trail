# @agent-trail/adapters

Per-source-agent parsers that convert native session files into Agent Trail
entries. Verified adapters: `claude-code`, `pi`. Pending: Codex CLI, Cursor,
OpenCode, Aider (see `docs/parser-source-matrix.md`).

## Shared seam

All adapters build on a single internal seam:

- [`src/entries.ts`](./src/entries.ts) — `createEntryId`, `createSourceFor`,
  `pickBlockId`. Adapter-neutral entry construction.
- [`src/parenting.ts`](./src/parenting.ts) — `resolveEntryParents`. Walks the
  source-id chain to map adapter-native parent references to trail entry ids.
- [`src/source-raw.ts`](./src/source-raw.ts) — `enforceSourceRawSize`,
  `redactValue`. Size enforcement and credential redaction for `source.raw`.

## Boundaries with `@agent-trail/core`

`enforceSourceRawSize` and `redactValue` are **adapter-internal**. They moved
out of `@agent-trail/core` so the core package stays focused on the trail
file contract (parsing, validation, hashing, reconciliation) and does not
ship adapter-specific raw-handling code.

`@agent-trail/core` continues to re-export the related constants for
consumers that compute their own size budgets or pattern lists:

- `SOURCE_RAW_HARD_CAP_BYTES`, `SOURCE_RAW_SOFT_CAP_BYTES`
- `BEARER_TOKEN`, `CREDENTIAL_PATTERNS`, and the other named patterns from
  `secret-patterns.ts`

If you are writing an adapter outside this workspace, import the constants
from `@agent-trail/core` and implement your own size/redaction policy — or
copy the helpers in `src/source-raw.ts`.

## `SourceForOptions.schemaVersion`

`createSourceFor` accepts an optional `schemaVersion` on `SourceForOptions`.
It is plumbed uniformly through both verified adapters:

- **pi** uses it as a fallback when the envelope's own version field is
  missing.
- **claude-code** currently passes `undefined` (envelopes always carry their
  own version), but the option is available so future call sites can supply
  one without touching the shared factory.

If a future adapter needs a different resolution strategy, override
`resolveSchemaVersion` in its `CreateSourceForConfig` rather than special-
casing the option.

## Tests

- `bun test` (from repo root or this package) runs the adapter test suite,
  including the shared-seam unit tests in `src/parenting.test.ts` and
  `src/source-raw.test.ts`.
