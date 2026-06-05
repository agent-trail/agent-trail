import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonlHead, readJsonlHeadObjects } from "./jsonl-head.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "adapter-jsonl-head-"));
});

afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

describe("readJsonlHead", () => {
  test("returns complete lines when the byte cap does not truncate", async () => {
    const path = fixture("complete.jsonl", '{"a":1}\n{"b":2}\n');

    await expect(readJsonlHead(path, 100)).resolves.toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      truncated: false,
    });
  });

  test("drops the partial trailing line when the byte cap truncates", async () => {
    const path = fixture("truncated.jsonl", '{"a":1}\n{"b":2}\n');

    await expect(readJsonlHead(path, 12)).resolves.toEqual({
      lines: ['{"a":1}'],
      truncated: true,
    });
  });
});

describe("readJsonlHeadObjects", () => {
  test("returns parseable object records and skips malformed lines", async () => {
    const path = fixture("objects.jsonl", '{"a":1}\nnot-json\n[]\n{"b":2}\n');

    await expect(readJsonlHeadObjects(path, 100)).resolves.toEqual([{ a: 1 }, { b: 2 }]);
  });
});
