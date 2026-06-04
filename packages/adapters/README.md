# @agent-trail/adapters

Per-source-agent parsers that convert native session files into Agent Trail
entries. Verified adapters: `claude-code`, `codex`, `opencode`, `pi`.
Pending: Cursor, Aider (see `docs/parser-source-matrix.md`).

For the end-to-end checklist for adding a new adapter, see
[`docs/adapter-authoring.md`](../../docs/adapter-authoring.md).

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
- `tests/fixtures/real-sessions` contains manually redacted real source-session
  fixtures and matching expected Agent Trail JSONL output. The fixture test
  parses each committed source file and byte-compares the emitted trail to the
  matching golden file, so source-schema drift is caught without needing local
  real sessions.
- Real-session smoke tests are local checks only. They are hard-skipped whenever
  `CI` is set, even if a real-session env var is present. Locally, they use the
  adapter default session roots (`~/.pi/agent/sessions`, `~/.codex/sessions`,
  `~/.claude/projects`) and the agents' own root overrides (`PI_CODING_AGENT_DIR`,
  `PI_CODING_AGENT_SESSION_DIR`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`). Real local
  session files must stay out of git.

  From the repository root:

  ```bash
  bun test packages/adapters/src/pi/real-session.test.ts \
    packages/adapters/src/codex/real-session.test.ts \
    packages/adapters/src/claude-code/real-session.test.ts \
    packages/adapters/src/opencode/real-session.test.ts
  ```

  From `packages/adapters`:

  ```bash
  bun test src/pi/real-session.test.ts \
    src/codex/real-session.test.ts \
    src/claude-code/real-session.test.ts \
    src/opencode/real-session.test.ts
  ```

  Use `AGENT_TRAIL_REAL_*_SESSION` only when testing a specific custom session
  file:

  ```bash
  AGENT_TRAIL_REAL_PI_SESSION=/abs/path/to/pi-session.jsonl bun test packages/adapters
  AGENT_TRAIL_REAL_CODEX_SESSION=/abs/path/to/rollout-...jsonl bun test packages/adapters
  AGENT_TRAIL_REAL_CLAUDE_CODE_SESSION=/abs/path/to/claude-session.jsonl bun test packages/adapters
  AGENT_TRAIL_REAL_OPENCODE_ROOT=/abs/path/to/opencode bun test packages/adapters
  AGENT_TRAIL_REAL_OPENCODE_DB_SESSION=/abs/path/to/opencode.db#ses_... bun test packages/adapters
  ```

  Smoke tests parse the real session, validate emitted Agent Trail records, and
  check broad feature invariants when event families are present. They do not
  require a specific transcript shape.
