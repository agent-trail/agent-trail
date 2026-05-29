# @agent-trail/adapter-kit

Shared extraction primitives and source readers for Agent Trail adapters. Adapters compose these
instead of reimplementing the same low-level extraction, coercion, and file-reading logic.

This is the Phase 1 surface of the adapter-kit redesign (epic
[#135](https://github.com/agent-trail/agent-trail/issues/135)): primitives plus the `SourceReader`
abstraction. The mapping DSL, reconciler, source-schema validation, and `SqliteReader` land in later
phases.

## Primitives

| Export | Signature | Purpose |
|---|---|---|
| `isObject` | `(v: unknown) => v is Record<string, unknown>` | Non-null object guard (arrays included). |
| `stringValue` | `(v: unknown) => string \| undefined` | Returns `v` when a string. |
| `jsonObjectValue` | `(v: unknown) => Record<string, unknown> \| undefined` | Returns `v` when a non-null object. |
| `coerceInt` | `(v: unknown) => number \| undefined` | Returns `v` when a finite number. Strict — no string coercion. |
| `quoteShellArg` | `(v: string) => string` | POSIX single-quote a shell token when it has special chars. |
| `commandFrom` | `(args) => string \| undefined` | Canonical shell command: `command` string → `cmd` string → argv array (quoted/joined; partial argv refused). |
| `filePathFrom` | `(args) => string \| undefined` | `file_path` then `path`. |
| `pick` | `(record, keys) => number \| undefined` | First non-negative-integer value across candidate keys. |
| `mapAgentMessageUsage` | `(raw) => AgentMessageUsage \| undefined` | Maps a source usage envelope to spec §9.2 `payload.usage` (snake/camel, cache renames). |

## Source readers

```ts
interface SourcePointer { path: string }
type RawRecord = Record<string, unknown>;

interface SourceReader {
  records(source: SourcePointer): AsyncIterable<RawRecord>;
  schemaVersion(source: SourcePointer): Promise<string | undefined>;
  identityHash(source: SourcePointer): Promise<string>; // sha256 hex of source bytes
}
```

- `new JsonlReader({ versionFrom? })` — newline-delimited JSON; yields one parsed object per line,
  skipping blank and malformed lines. `schemaVersion` derives from the first record via `versionFrom`.
- `chainReaders(readers)` — drains readers sequentially; use when temporal interleaving is irrelevant.
- `mergeByTimestamp(readers, { timestampFrom? })` — interleaves records by ascending timestamp
  (stable for equal/absent timestamps). Only sound when sources emit comparable timestamps.

`SqliteReader` is not shipped in Phase 1; the interface and composition helpers are sized to accept
it without breaking changes.
