import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { RawRecord, SourcePointer, SourceReader } from "../index.ts";
import { chainReaders, mergeByTimestamp } from "../index.ts";

class FakeReader implements SourceReader {
  constructor(
    private readonly rows: RawRecord[],
    private readonly hash: string,
    private readonly version?: string,
  ) {}
  async *records(_source: SourcePointer): AsyncIterable<RawRecord> {
    for (const row of this.rows) yield row;
  }
  async schemaVersion(): Promise<string | undefined> {
    return this.version;
  }
  async identityHash(): Promise<string> {
    return this.hash;
  }
}

const SRC: SourcePointer = { path: "ignored" };

async function collect(reader: SourceReader): Promise<RawRecord[]> {
  const out: RawRecord[] = [];
  for await (const r of reader.records(SRC)) out.push(r);
  return out;
}

test("chainReaders: drains readers in order", async () => {
  const reader = chainReaders([
    new FakeReader([{ a: 1 }, { a: 2 }], "h1"),
    new FakeReader([{ b: 1 }], "h2"),
  ]);
  expect(await collect(reader)).toEqual([{ a: 1 }, { a: 2 }, { b: 1 }]);
});

test("chainReaders: schemaVersion comes from first reader", async () => {
  const reader = chainReaders([new FakeReader([], "h1", "0.60"), new FakeReader([], "h2", "1")]);
  expect(await reader.schemaVersion(SRC)).toBe("0.60");
});

test("chainReaders: identityHash combines child hashes", async () => {
  const reader = chainReaders([new FakeReader([], "h1"), new FakeReader([], "h2")]);
  const expected = createHash("sha256").update("h1\nh2").digest("hex");
  expect(await reader.identityHash(SRC)).toBe(expected);
});

test("mergeByTimestamp: interleaves records by timestamp ascending", async () => {
  const reader = mergeByTimestamp([
    new FakeReader(
      [
        { id: "a", timestamp: 1 },
        { id: "c", timestamp: 3 },
      ],
      "h1",
    ),
    new FakeReader(
      [
        { id: "b", timestamp: 2 },
        { id: "d", timestamp: 4 },
      ],
      "h2",
    ),
  ]);
  expect((await collect(reader)).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
});

test("mergeByTimestamp: stable for equal timestamps (reader order preserved)", async () => {
  const reader = mergeByTimestamp([
    new FakeReader([{ id: "a", timestamp: 1 }], "h1"),
    new FakeReader([{ id: "b", timestamp: 1 }], "h2"),
  ]);
  expect((await collect(reader)).map((r) => r.id)).toEqual(["a", "b"]);
});

test("mergeByTimestamp: custom timestampFrom accessor", async () => {
  const reader = mergeByTimestamp(
    [new FakeReader([{ id: "late", ts: 9 }], "h1"), new FakeReader([{ id: "early", ts: 2 }], "h2")],
    { timestampFrom: (r) => Number(r.ts) },
  );
  expect((await collect(reader)).map((r) => r.id)).toEqual(["early", "late"]);
});

test("mergeByTimestamp: records without a timestamp sort before timestamped ones, reader order kept", async () => {
  const reader = mergeByTimestamp([
    new FakeReader([{ id: "tsd", timestamp: 5 }], "h1"),
    new FakeReader([{ id: "none-a" }, { id: "none-b" }], "h2"),
  ]);
  expect((await collect(reader)).map((r) => r.id)).toEqual(["none-a", "none-b", "tsd"]);
});

test("mergeByTimestamp: default accessor parses numeric-string timestamps", async () => {
  const reader = mergeByTimestamp([
    new FakeReader([{ id: "b", timestamp: "20" }], "h1"),
    new FakeReader([{ id: "a", timestamp: "3" }], "h2"),
  ]);
  expect((await collect(reader)).map((r) => r.id)).toEqual(["a", "b"]);
});

test("mergeByTimestamp: non-numeric timestamp treated as absent", async () => {
  const reader = mergeByTimestamp([
    new FakeReader([{ id: "tsd", timestamp: 1 }], "h1"),
    new FakeReader([{ id: "bad", timestamp: "not-a-number" }], "h2"),
  ]);
  expect((await collect(reader)).map((r) => r.id)).toEqual(["bad", "tsd"]);
});

test("chainReaders: empty reader list yields nothing and undefined version", async () => {
  const reader = chainReaders([]);
  expect(await collect(reader)).toEqual([]);
  expect(await reader.schemaVersion(SRC)).toBeUndefined();
});

test("mergeByTimestamp: empty reader list yields nothing", async () => {
  const reader = mergeByTimestamp([]);
  expect(await collect(reader)).toEqual([]);
});
