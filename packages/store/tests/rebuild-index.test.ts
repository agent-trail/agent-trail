import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IndexVersionError, rebuildIndex, registerTrail } from "../src/index.ts";

const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const fixturePath = (rel: string) => fileURLToPath(new URL(rel, FIXTURES));

const FINALIZED_FIXTURE = fixturePath("valid/minimal-with-content-hash.trail.jsonl");
const FINALIZED_HASH = "8dbf946e5d4ccd2a4ff2681d2c2fe2614f0769bdfeafe5e4f242db14872db5f7";

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-store-rebuild-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

test("rebuildIndex regenerates the index from on-disk objects after the index is deleted", async () => {
  await registerTrail(FINALIZED_FIXTURE, { storeRoot });

  const indexPath = join(storeRoot, "index", "objects.json");
  await unlink(indexPath);

  const summary = await rebuildIndex({ storeRoot });
  expect(summary.entries).toBe(1);

  const indexValue = JSON.parse(await readFile(indexPath, "utf8")) as {
    version: number;
    entries: Record<string, { registered_at: string; source_path: string | null }>;
  };
  expect(indexValue.version).toBe(1);
  expect(indexValue.entries[FINALIZED_HASH]).toBeDefined();
  expect(indexValue.entries[FINALIZED_HASH]?.source_path).toBeNull();
  expect(new Date(indexValue.entries[FINALIZED_HASH]?.registered_at ?? "").getTime()).not.toBeNaN();
});

test("registerTrail throws IndexVersionError when index/objects.json has an unsupported version", async () => {
  await mkdir(join(storeRoot, "index"), { recursive: true });
  await writeFile(
    join(storeRoot, "index", "objects.json"),
    `${JSON.stringify({ version: 999, entries: {} })}\n`,
    "utf8",
  );

  await expect(
    registerTrail(fixturePath("valid/minimal-with-content-hash.trail.jsonl"), { storeRoot }),
  ).rejects.toBeInstanceOf(IndexVersionError);
});

test("rebuildIndex skips corrupt object files and continues with valid ones", async () => {
  await registerTrail(fixturePath("valid/minimal-with-content-hash.trail.jsonl"), {
    storeRoot,
  });

  const objectsDir = join(storeRoot, "objects", "sha256");
  // Valid filename pattern but unparseable content
  const corruptHash = "f".repeat(64);
  await writeFile(join(objectsDir, `${corruptHash}.trail.jsonl`), "{not jsonl\n", "utf8");

  const summary = await rebuildIndex({ storeRoot });
  expect(summary.entries).toBe(1);

  const indexValue = JSON.parse(
    await readFile(join(storeRoot, "index", "objects.json"), "utf8"),
  ) as { entries: Record<string, unknown> };
  expect(Object.keys(indexValue.entries)).toEqual([FINALIZED_HASH]);
});

test("rebuildIndex ignores stray files in objects/sha256 that do not match <hex>.trail.jsonl", async () => {
  await registerTrail(FINALIZED_FIXTURE, { storeRoot });

  const objectsDir = join(storeRoot, "objects", "sha256");
  await mkdir(objectsDir, { recursive: true });
  await writeFile(join(objectsDir, "README.md"), "stray\n", "utf8");
  await writeFile(join(objectsDir, "not-a-hash.trail.jsonl"), "{}\n", "utf8");
  await writeFile(join(objectsDir, "deadbeef.trail.jsonl"), "{}\n", "utf8"); // wrong length

  const summary = await rebuildIndex({ storeRoot });
  expect(summary.entries).toBe(1);

  const indexValue = JSON.parse(
    await readFile(join(storeRoot, "index", "objects.json"), "utf8"),
  ) as { entries: Record<string, unknown> };
  expect(Object.keys(indexValue.entries)).toEqual([FINALIZED_HASH]);
});
