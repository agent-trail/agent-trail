import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalizeRecords, computeContentHash, parseJsonlString } from "@agent-trail/core";
import { registerTrail } from "@agent-trail/store";
import { runExport } from "./export.ts";

type SeedOpts = {
  agentName?: string;
  id?: string;
  text?: string;
};

async function seedRegistered(
  storeRoot: string,
  opts: SeedOpts = {},
): Promise<{ contentHash: string; canonical: string; objectPath: string }> {
  const agentName = opts.agentName ?? "codex-cli";
  const id = opts.id ?? "sess1";
  const text = opts.text ?? "hello";
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id,
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: agentName },
  };
  const userMsg = {
    type: "user_message",
    id: "evta1",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text },
  };
  const draft = `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`;
  const draftRecords = await parseJsonlString(draft);
  const contentHash = computeContentHash(draftRecords);
  header.content_hash = contentHash;
  const finalBytes = `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`;
  const stageDir = mkdtempSync(join(tmpdir(), "trail-export-seed-"));
  const stagePath = join(stageDir, "seed.trail.jsonl");
  writeFileSync(stagePath, finalBytes);
  const reg = await registerTrail(stagePath, { storeRoot, sourcePath: null });
  rmSync(stageDir, { recursive: true, force: true });
  if (reg.contentHash === null || reg.objectPath === null) {
    throw new Error(`seed failed: status=${reg.status}`);
  }
  const finalRecords = await parseJsonlString(finalBytes);
  const canonical = canonicalizeRecords(finalRecords);
  return { contentHash: reg.contentHash, canonical, objectPath: reg.objectPath };
}

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-export-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

test("missing positional: exits 1 with usage", async () => {
  const result = await runExport([], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Usage: trail export <id>");
});

test("tracer: full hash writes canonical store bytes to stdout", async () => {
  const seed = await seedRegistered(storeRoot);

  const result = await runExport([seed.contentHash], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(seed.canonical);
  const onDisk = await readFile(seed.objectPath, "utf8");
  expect(result.stdout).toBe(onDisk);
});

test("unknown full hash: exits 1 with diagnostic", async () => {
  const missing = "0".repeat(64);
  const result = await runExport([missing], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`export: unknown id: ${missing}`);
});

test("short prefix: unique index match resolves to full hash", async () => {
  const seed = await seedRegistered(storeRoot);
  const prefix = seed.contentHash.slice(0, 12);

  const result = await runExport([prefix], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(seed.canonical);
});

test("short prefix: ambiguous match exits 1 and lists candidates", async () => {
  // Hand-crafted index with two entries sharing an 8-hex-char prefix. Object
  // files are unnecessary: ambiguous-prefix resolution exits before reading them.
  const hashA = `deadbeef${"a".repeat(56)}`;
  const hashB = `deadbeef${"b".repeat(56)}`;
  const indexDir = join(storeRoot, "index");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(
    join(indexDir, "objects.json"),
    `${JSON.stringify(
      {
        version: 1,
        entries: {
          [hashA]: { registered_at: "2026-05-17T14:00:00.000Z", source_path: null },
          [hashB]: { registered_at: "2026-05-17T14:00:00.000Z", source_path: null },
        },
      },
      null,
      2,
    )}\n`,
  );
  const prefix = "deadbeef";

  const result = await runExport([prefix], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`export: ambiguous id: ${prefix}`);
  expect(result.stderr).toContain(hashA);
  expect(result.stderr).toContain(hashB);
});

test("invalid id shape: non-hex exits 1", async () => {
  const result = await runExport(["NOT-HEX!"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("export: invalid id: NOT-HEX!");
});

test("invalid id shape: too short exits 1", async () => {
  const result = await runExport(["abc"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("export: invalid id: abc");
});

test("short prefix: no index match exits 1 with unknown id", async () => {
  await seedRegistered(storeRoot);
  // Pick a prefix that cannot collide with the seed hash. Caller-supplied
  // input shape: 8 hex chars (minimum prefix).
  const prefix = "deadbeef";

  const result = await runExport([prefix], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(`export: unknown id: ${prefix}`);
});

test("--out --force overwrites existing file", async () => {
  const seed = await seedRegistered(storeRoot);
  const outPath = join(storeRoot, "exists.trail.jsonl");
  writeFileSync(outPath, "PRE-EXISTING");

  const result = await runExport([seed.contentHash, "--out", outPath, "--force"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const written = await readFile(outPath, "utf8");
  expect(written).toBe(seed.canonical);
});

test("--out creates missing parent directories", async () => {
  const seed = await seedRegistered(storeRoot);
  const outPath = join(storeRoot, "nested", "deeper", "out.trail.jsonl");

  const result = await runExport([seed.contentHash, "--out", outPath], { storeRoot });

  expect(result.exitCode).toBe(0);
  const written = await readFile(outPath, "utf8");
  expect(written).toBe(seed.canonical);
});

test("round-trip: exported bytes hash back to the requested content_hash", async () => {
  const seed = await seedRegistered(storeRoot);

  const result = await runExport([seed.contentHash], { storeRoot });

  expect(result.exitCode).toBe(0);
  const reparsed = await parseJsonlString(result.stdout);
  const recomputed = computeContentHash(reparsed);
  expect(recomputed).toBe(seed.contentHash);
});

test("corrupt index: short-prefix lookup exits 1 with diagnostic", async () => {
  const indexDir = join(storeRoot, "index");
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(join(indexDir, "objects.json"), "{not valid json");

  const result = await runExport(["deadbeef"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toLowerCase()).toContain("malformed json");
});

test("--out is a directory: exits 1", async () => {
  const seed = await seedRegistered(storeRoot);
  const outDir = join(storeRoot, "out-dir");
  mkdirSync(outDir, { recursive: true });

  const result = await runExport([seed.contentHash, "--out", outDir], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("--out path is a directory");
});

test("--out refuses to clobber existing file", async () => {
  const seed = await seedRegistered(storeRoot);
  const outPath = join(storeRoot, "exists.trail.jsonl");
  writeFileSync(outPath, "PRE-EXISTING");

  const result = await runExport([seed.contentHash, "--out", outPath], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain(outPath);
  expect(result.stderr).toContain("--force");
  const untouched = await readFile(outPath, "utf8");
  expect(untouched).toBe("PRE-EXISTING");
});

test("--out writes bytes to file, stdout empty", async () => {
  const seed = await seedRegistered(storeRoot);
  const outPath = join(storeRoot, "out.trail.jsonl");

  const result = await runExport([seed.contentHash, "--out", outPath], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe("");
  const written = await readFile(outPath, "utf8");
  expect(written).toBe(seed.canonical);
});
