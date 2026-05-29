export { type Adapter, defineAdapter } from "./define-adapter.ts";
export { defineMapping } from "./define-mapping.ts";
export { dispatch } from "./dispatch.ts";
export { type Pass1Params, runPass1 } from "./engine.ts";
export { deriveSessionUid, deriveSynthesizedEntryId } from "./ids.ts";
export { matchesPattern } from "./match.ts";
export { commandFrom, filePathFrom } from "./primitives/args.ts";
export { coerceInt } from "./primitives/coerce.ts";
export { isObject, jsonObjectValue, stringValue } from "./primitives/guards.ts";
export { quoteShellArg } from "./primitives/shell.ts";
export { type AgentMessageUsage, mapAgentMessageUsage, pick } from "./primitives/usage.ts";
export {
  type QuarantineDraftInput,
  type QuarantineInput,
  quarantine,
  quarantineDraft,
} from "./quarantine.ts";
export {
  chainReaders,
  type MergeByTimestampOptions,
  mergeByTimestamp,
} from "./readers/compose.ts";
export { JsonlReader, type JsonlReaderOptions } from "./readers/jsonl-reader.ts";
// SqliteReader is driver-agnostic. Under Bun, import the driver from the
// `@agent-trail/adapter-kit/bun-sqlite` subpath (`bunSqliteDriver`); Node
// consumers inject a `better-sqlite3` wrapper matching the `SqliteDriver` shape.
export {
  type SqliteConnection,
  type SqliteDriver,
  type SqlitePreparedStatement,
  SqliteReader,
  type SqliteReaderOptions,
} from "./readers/sqlite-reader.ts";
export type { RawRecord, SourcePointer, SourceReader } from "./readers/types.ts";
export { reconcile } from "./reconciler/index.ts";
export { selectSchemaVersion } from "./source-schemas/select.ts";
export { validateSourceRecord } from "./source-schemas/validate.ts";
export type {
  AdapterDef,
  LinkerHints,
  MappingDef,
  MatchPattern,
  OverrideCtx,
  OverrideDef,
  ParseOptions,
  ReconcilerConfig,
  ReconcilerRule,
  ReconcilerRuleCtx,
  TrailEntryDraft,
} from "./types.ts";
