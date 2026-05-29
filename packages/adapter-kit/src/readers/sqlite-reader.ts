import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RawRecord, SourcePointer, SourceReader } from "./types.ts";

// Minimal SQLite driver surface the reader needs. Kept tiny and driver-agnostic
// so the reader works under both Bun (`bun:sqlite`, shipped via the
// `@agent-trail/adapter-kit/bun-sqlite` subpath) and Node (a consumer-supplied
// `better-sqlite3` wrapper). `better-sqlite3` cannot load under Bun
// (oven-sh/bun#4290), so the driver is injected rather than imported here.
export interface SqlitePreparedStatement {
  all(): Record<string, unknown>[];
}
export interface SqliteConnection {
  prepare(sql: string): SqlitePreparedStatement;
  close(): void;
}
export interface SqliteDriver {
  open(path: string): SqliteConnection;
}

export interface SqliteReaderOptions {
  // Named SQL queries, run in declared order. Each MUST carry an `ORDER BY`
  // matching the source's temporal semantics — the reader assumes records
  // arrive in canonical order (epic §14.5); reordering is the query's job.
  queries: Record<string, string>;
  // Projects one result row (plus its originating query name) into a raw
  // record. The query name is the natural discriminator for downstream mapping.
  rowToRecord: (queryName: string, row: Record<string, unknown>) => RawRecord;
  // SQLite driver. Inject `bunSqliteDriver` under Bun, or a `better-sqlite3`
  // wrapper under Node.
  driver: SqliteDriver;
}

// Reads SQLite-backed sources (e.g. Cursor / Copilot `state.vscdb`). Storage
// knowledge stays at this boundary; everything above the reader is identical to
// JSONL adapters. Re-importing a mutated DB yields a different trail by design —
// trails are point-in-time snapshots (epic §14.4).
//
// records(), schemaVersion(), and identityHash() each open the DB independently
// (stateless, mirroring JsonlReader); revisit with caching only if profiled hot.
export class SqliteReader implements SourceReader {
  constructor(private readonly options: SqliteReaderOptions) {}

  async *records(source: SourcePointer): AsyncIterable<RawRecord> {
    const db = this.options.driver.open(source.path);
    try {
      for (const [queryName, sql] of Object.entries(this.options.queries)) {
        for (const row of db.prepare(sql).all()) {
          yield this.options.rowToRecord(queryName, row);
        }
      }
    } finally {
      db.close();
    }
  }

  async schemaVersion(source: SourcePointer): Promise<string | undefined> {
    const db = this.options.driver.open(source.path);
    try {
      const row = db.prepare("PRAGMA user_version").all()[0];
      const version = row?.user_version;
      return version === undefined || version === null ? undefined : String(version);
    } finally {
      db.close();
    }
  }

  async identityHash(source: SourcePointer): Promise<string> {
    const bytes = await readFile(source.path);
    return createHash("sha256").update(bytes).digest("hex");
  }
}
