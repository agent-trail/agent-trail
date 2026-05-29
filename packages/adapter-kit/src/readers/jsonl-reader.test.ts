import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlReader } from "../index.ts";

const dir = mkdtempSync(join(tmpdir(), "adapter-kit-jsonl-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fixture(name: string, text: string): { path: string } {
  const path = join(dir, name);
  writeFileSync(path, text);
  return { path };
}

async function collect(reader: JsonlReader, source: { path: string }) {
  const out: Record<string, unknown>[] = [];
  for await (const record of reader.records(source)) out.push(record);
  return out;
}

test("records: yields parsed objects, skipping empty lines", async () => {
  const source = fixture("basic.jsonl", '{"a":1}\n{"b":2}\n\n');
  const records = await collect(new JsonlReader(), source);
  expect(records).toEqual([{ a: 1 }, { b: 2 }]);
});

test("records: skips malformed lines defensively", async () => {
  const source = fixture("malformed.jsonl", '{"a":1}\nnot json\n{"c":3}\n');
  const records = await collect(new JsonlReader(), source);
  expect(records).toEqual([{ a: 1 }, { c: 3 }]);
});

test("records: skips non-object JSON lines (arrays, scalars)", async () => {
  const source = fixture("nonobject.jsonl", '{"a":1}\n[1,2,3]\n42\n"str"\n{"b":2}\n');
  const records = await collect(new JsonlReader(), source);
  expect(records).toEqual([{ a: 1 }, { b: 2 }]);
});

test("identityHash: sha256 hex of file bytes", async () => {
  const text = '{"a":1}\n';
  const source = fixture("hash.jsonl", text);
  const expected = createHash("sha256").update(text).digest("hex");
  expect(await new JsonlReader().identityHash(source)).toBe(expected);
});

test("schemaVersion: derived from first record via versionFrom", async () => {
  const source = fixture("version.jsonl", '{"v":"0.60","type":"session_meta"}\n{"b":2}\n');
  const reader = new JsonlReader({ versionFrom: (first) => String(first.v) });
  expect(await reader.schemaVersion(source)).toBe("0.60");
});

test("schemaVersion: undefined when no versionFrom provided", async () => {
  const source = fixture("noversion.jsonl", '{"a":1}\n');
  expect(await new JsonlReader().schemaVersion(source)).toBeUndefined();
});

test("schemaVersion: undefined for empty file", async () => {
  const source = fixture("empty.jsonl", "");
  const reader = new JsonlReader({ versionFrom: (first) => String(first.v) });
  expect(await reader.schemaVersion(source)).toBeUndefined();
});
