export { commandFrom, filePathFrom } from "./primitives/args.ts";
export { coerceInt } from "./primitives/coerce.ts";
export { isObject, jsonObjectValue, stringValue } from "./primitives/guards.ts";
export { quoteShellArg } from "./primitives/shell.ts";
export { type AgentMessageUsage, mapAgentMessageUsage, pick } from "./primitives/usage.ts";
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
export { selectSchemaVersion } from "./source-schemas/select.ts";
export { validateSourceRecord } from "./source-schemas/validate.ts";
