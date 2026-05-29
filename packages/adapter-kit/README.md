# @agent-trail/adapter-kit

Shared extraction primitives and source readers for Agent Trail adapters. Adapters compose these
instead of reimplementing the same low-level extraction, coercion, and file-reading logic.

Part of the adapter-kit redesign (epic
[#135](https://github.com/agent-trail/agent-trail/issues/135)): primitives, the `SourceReader`
abstraction, source-schema validation, and the typed mapping DSL + two-pass reconciler. The kit is
ready; per-adapter migration to it is tracked separately (epic Phase 4).

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

## Source schema validation

Validate raw upstream records against bundled JSON Schemas before mapping to trail format. Schemas
ship in [`@agent-trail/source-schemas`](../source-schemas) and are loaded by the kit's static
registry — no path-based loading required.

| Export | Purpose |
|---|---|
| `selectSchemaVersion(agent, sourceVersion)` | Resolve a schema version key from an upstream version (semver string or number). Returns the registered `fallback` when nothing matches, `undefined` for unknown agent or missing version. |
| `validateSourceRecord(agent, schemaVersion, record)` | Validate a `RawRecord` against the schema. Returns `Diagnostic[]` (`[]` on success). Unknown `agent/schemaVersion` returns a single `unknown-source-schema` diagnostic instead of throwing. |

Typical adapter loop:

```ts
import {
  JsonlReader,
  selectSchemaVersion,
  validateSourceRecord,
} from "@agent-trail/adapter-kit";

const schemaVersion = selectSchemaVersion("codex", session.cli_version);
if (schemaVersion === undefined) {
  // quarantine the whole session — no schema to validate against
  return;
}

const reader = new JsonlReader();
for await (const record of reader.records(source)) {
  const diags = validateSourceRecord("codex", schemaVersion, record);
  if (diags.length > 0) {
    // quarantine the record — see formatDiagnosticsText from @agent-trail/core
    continue;
  }
  // convert record to trail format
}
```

Diagnostic codes are semantic (`source-enum-mismatch`, `source-missing-required-field`,
`source-type-mismatch`, `source-unexpected-field`, ...) so downstream tooling can route by class
rather than parsing free-form messages.

## Mapping DSL + reconciler

An adapter is a `SourceReader`, a set of typed mappings, and an opt-in reconciler config. The kit
runs a two-pass model: **pass 1** is pure per-record mappings emitting `TrailEntryDraft[]`; **pass 2**
is the reconciler filling cross-references and stripping transient hints.

```ts
import { defineAdapter, defineMapping, JsonlReader } from "@agent-trail/adapter-kit";

const responseMessage = defineMapping<ResponseItemMessage>({
  match: { type: "response_item", payload: { type: "message" } }, // deep-partial match
  emit: (record) => [
    {
      type: "agent_message",
      payload: { text: record.payload.content[0]?.text },
      meta: { linker: { call_id: record.payload.id } }, // transient hint for the reconciler
    },
  ],
});

const adapter = defineAdapter({
  agent: "codex",
  idNamespace: CODEX_ENTRY_ID_NAMESPACE, // UUID; seeds deterministic entry ids
  quarantineNamespace: "codex",          // kebab-case; drift events are `x-codex/unknown_record`
  sourceFormatVersions: ["v0.128"],
  reader: new JsonlReader({ versionFrom: (first) => String(first.cli_version) }),
  tsFrom: (record) => String(record.timestamp),
  mappings: [responseMessage /* , ... */],
  reconciler: { toolLinking: true, parentChain: true, cumulativeTokens: false },
});

const entries = await adapter.parse({ path }, { sessionUid });
// `entries` is a complete `Entry[]`, ready for writer-strict validation or export.
```

`parse()` reads the whole source into memory before pass 1 (overrides' `ctx.window.recent`
back-look needs random access). Fine for typical coding sessions; not a streaming-only path.

### Pass 1 — pure mappings

- `defineMapping<T>({ match, emit })` — `match` is a deep-partial pattern (every key present must
  deep-equal the record; nested objects recurse). Dispatch is first-match-wins, so order
  most-specific first. `emit(record): TrailEntryDraft[]` is sync and pure — no state, no window.
- A draft omits `id`/`ts` (the engine assigns them) and may omit `parent_id` (the reconciler fills
  it). Array return is the cardinality knob: `[]` drops the record, one entry is the normal case,
  many entries is a fanout (e.g. a content block list).
- The engine assigns each entry a deterministic id from `[sessionUid, recordIndex, type, ordinal]`
  (re-parse stable) and `ts` via `tsFrom`.
- Records that fail source-schema validation are rerouted to a lossless `quarantine` `system_event`
  (`x-<namespace>/unknown_record`) instead of being dropped — drift stays visible and countable.

### Overrides — state/window escape hatch

For per-adapter logic that needs cross-record state, declare an `override` instead of a mapping:

```ts
overrides: [{
  match: { type: "web_search_call" },
  emit: (record, ctx) => {
    ctx.state.pending = record.query;           // mutable per-parse state (seeded by initialState)
    const prior = ctx.window.recent(5);          // back-look at recent raw records
    ctx.emit({ type: "system_event", payload: { /* synthetic */ } });
    return [/* drafts */];
  },
}],
initialState: () => ({ pending: undefined }),
```

Overrides take precedence over a pure mapping that matches the same record. `ctx.state` is mutable
and shared across every record in the parse, and overrides run in match order — two overrides that
write the same state field are order-dependent, so keep coupled state logic in a single override.
An override that reads `ctx.state` requires `initialState` (the engine throws otherwise).

### Pass 2 — reconciler

Built-in rules are opt-in via `ReconcilerConfig` and run in fixed order, then any `custom` passes,
then `meta.linker` is stripped:

| Flag | Effect |
|---|---|
| `toolLinking` | Links `tool_result` → `tool_call` via `meta.linker.call_id`; sets `payload.for_id` + `semantic.call_id`. |
| `parentChain` | Fills `parent_id` = previous emitted entry (root is `null`); a draft's explicit `parent_id` wins. |
| `cumulativeTokens` | Computes `input/output_tokens_cumulative` on `agent_message` usage when absent; skip for sources that emit them natively. |
| `branchReconciliation` | Tree-topology adapters (Pi). Not yet implemented — enabling it throws until Phase 4. |
| `custom` | `ReconcilerRule[]` = `(entries, ctx) => entries`, run after built-ins in array order. The extension point for adapter-specific passes. |

When to enable each flag:

- `toolLinking` — your mappings attach `meta.linker.call_id` to tool calls/results and you want the
  pair linked. Leave off if the source already provides `payload.for_id`.
- `parentChain` — linear sessions. Off for tree-topology adapters, which set `parent_id` per draft
  (and will use `branchReconciliation` once it lands).
- `cumulativeTokens` — the source emits per-turn `input/output_tokens` but no running totals. Off if
  it emits cumulative counts natively (e.g. Codex). Requires Pass-1 output in chronological order.
- `branchReconciliation` — deferred to Phase 4; enabling it throws today.

`meta.linker` is transient — the trail `meta` field has no `linker` slot, so the reconciler removes
it (and drops `meta` entirely when nothing else remains) before returning the final `Entry[]`.
