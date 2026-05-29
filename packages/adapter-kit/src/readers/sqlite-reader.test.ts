import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bunSqliteDriver } from "./bun-sqlite-driver.ts";
import { SqliteReader } from "./sqlite-reader.ts";
import type { RawRecord } from "./types.ts";

let dir: string;
let dbPath: string;

function seed(path: string, userVersion: number): void {
  const db = new Database(path, { create: true });
  db.exec("CREATE TABLE messages (rowid INTEGER PRIMARY KEY, key TEXT, value TEXT)");
  db.exec("CREATE TABLE attachments (rowid INTEGER PRIMARY KEY, name TEXT)");
  const ins = db.prepare("INSERT INTO messages (rowid, key, value) VALUES (?, ?, ?)");
  ins.run(2, "composer:b", JSON.stringify({ text: "second" }));
  ins.run(1, "composer:a", JSON.stringify({ text: "first" }));
  db.prepare("INSERT INTO attachments (rowid, name) VALUES (?, ?)").run(1, "diagram.png");
  db.exec(`PRAGMA user_version = ${userVersion}`);
  db.close();
}

const options = {
  driver: bunSqliteDriver,
  queries: {
    messages: "SELECT key, value FROM messages ORDER BY rowid",
    attachments: "SELECT name FROM attachments ORDER BY rowid",
  },
  rowToRecord: (queryName: string, row: Record<string, unknown>): RawRecord => ({
    type: queryName,
    ...row,
  }),
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sqlite-reader-"));
  dbPath = join(dir, "state.vscdb");
  seed(dbPath, 7);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SqliteReader", () => {
  test("records() yields rows mapped through rowToRecord in ORDER BY order, queries in declared order", async () => {
    const reader = new SqliteReader(options);
    const records: RawRecord[] = [];
    for await (const record of reader.records({ path: dbPath })) {
      records.push(record);
    }
    expect(records).toEqual([
      { type: "messages", key: "composer:a", value: JSON.stringify({ text: "first" }) },
      { type: "messages", key: "composer:b", value: JSON.stringify({ text: "second" }) },
      { type: "attachments", name: "diagram.png" },
    ]);
  });

  test("schemaVersion() returns PRAGMA user_version as a string", async () => {
    const reader = new SqliteReader(options);
    expect(await reader.schemaVersion({ path: dbPath })).toBe("7");
  });

  test("identityHash() is a stable sha256 of the DB bytes that changes when the DB changes", async () => {
    const reader = new SqliteReader(options);
    const first = await reader.identityHash({ path: dbPath });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await reader.identityHash({ path: dbPath })).toBe(first);

    const otherPath = join(dir, "other.vscdb");
    seed(otherPath, 9);
    expect(await reader.identityHash({ path: otherPath })).not.toBe(first);
  });
});
