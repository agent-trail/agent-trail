import { Database } from "bun:sqlite";
import type { SqliteConnection, SqliteDriver } from "./sqlite-reader.ts";

// `bun:sqlite`-backed SqliteDriver. Lives behind the
// `@agent-trail/adapter-kit/bun-sqlite` subpath so importing the main kit entry
// under Node never pulls in the Bun-only `bun:sqlite` module.
export const bunSqliteDriver: SqliteDriver = {
  open(path: string): SqliteConnection {
    const db = new Database(path, { readonly: true });
    return {
      prepare(sql: string) {
        const statement = db.query(sql);
        return { all: () => statement.all() as Record<string, unknown>[] };
      },
      close() {
        db.close();
      },
    };
  },
};
