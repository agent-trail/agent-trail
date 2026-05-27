import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalizeRecords,
  computeContentHash,
  parseJsonlString,
  verifyContentHash,
} from "@agent-trail/core";
import { IndexCorruptError, registerTrail } from "../src/index.ts";

const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const fixturePath = (rel: string) => fileURLToPath(new URL(rel, FIXTURES));

const FINALIZED_FIXTURE = fixturePath("valid/minimal-with-content-hash.trail.jsonl");
const FINALIZED_HASH = "8dbf946e5d4ccd2a4ff2681d2c2fe2614f0769bdfeafe5e4f242db14872db5f7";
const STREAMING_OPEN_FIXTURE = fixturePath("valid/streaming-open.trail.jsonl");
const HASH_MISMATCH_FIXTURE = fixturePath("hash-mismatch/content-hash-mismatch.trail.jsonl");
const SCHEMA_INVALID_FIXTURE = fixturePath(
  "invalid-schema/header-wrong-schema-version.trail.jsonl",
);

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-store-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

test("registerTrail on a finalized fixture writes an object and returns status 'finalized'", async () => {
  const result = await registerTrail(FINALIZED_FIXTURE, { storeRoot });

  expect(result.status).toBe("finalized");
  expect(result.contentHash).toBe(FINALIZED_HASH);
  expect(result.objectPath).toBe(
    join(storeRoot, "objects", "sha256", `${FINALIZED_HASH}.trail.jsonl`),
  );
  expect(result.diagnostics).toEqual([]);

  const fileInfo = await stat(result.objectPath as string);
  expect(fileInfo.isFile()).toBe(true);
});

test("stored object bytes are canonicalizeRecords(records) and verify back to status 'match'", async () => {
  const result = await registerTrail(FINALIZED_FIXTURE, { storeRoot });
  const storedBytes = await readFile(result.objectPath as string, "utf8");

  const sourceRecords = await parseJsonlString(await readFile(FINALIZED_FIXTURE, "utf8"));
  const expectedCanonical = canonicalizeRecords(sourceRecords);

  expect(storedBytes).toBe(expectedCanonical);
  expect(storedBytes.endsWith("\n")).toBe(true);

  const storedRecords = await parseJsonlString(storedBytes);
  const firstRecord = storedRecords[0]?.value as { content_hash?: unknown };
  expect(firstRecord.content_hash).toBe(FINALIZED_HASH);

  const verification = verifyContentHash(storedRecords);
  expect(verification.status).toBe("match");
});

test("second registerTrail on the same fixture returns 'already_present' and does not duplicate", async () => {
  const first = await registerTrail(FINALIZED_FIXTURE, { storeRoot });
  expect(first.status).toBe("finalized");
  const firstBytes = await readFile(first.objectPath as string, "utf8");

  const second = await registerTrail(FINALIZED_FIXTURE, { storeRoot });
  expect(second.status).toBe("already_present");
  expect(second.contentHash).toBe(FINALIZED_HASH);
  expect(second.objectPath).toBe(first.objectPath);

  const secondBytes = await readFile(second.objectPath as string, "utf8");
  expect(secondBytes).toBe(firstBytes);
});

test("registerTrail overwrites a corrupted/drifted existing object and returns 'finalized'", async () => {
  const first = await registerTrail(FINALIZED_FIXTURE, { storeRoot });
  const objectPath = first.objectPath as string;

  // Simulate a drifted on-disk copy by inserting whitespace into the canonical
  // bytes. The on-disk hash no longer matches the canonical hash, so the
  // store should overwrite rather than return 'already_present'.
  const sourceRecords = await parseJsonlString(await readFile(FINALIZED_FIXTURE, "utf8"));
  const drifted = `  ${JSON.stringify(sourceRecords[0]?.value)}\n${JSON.stringify(
    sourceRecords[1]?.value,
  )}\n${JSON.stringify(sourceRecords[2]?.value)}\n`;
  await writeFile(objectPath, drifted, "utf8");

  const result = await registerTrail(FINALIZED_FIXTURE, { storeRoot });

  expect(result.status).toBe("finalized");
  const restoredBytes = await readFile(objectPath, "utf8");
  expect(restoredBytes).toBe(canonicalizeRecords(sourceRecords));
});

test("registerTrail on a streaming/pending header returns 'skipped_pending' and writes no object", async () => {
  const result = await registerTrail(STREAMING_OPEN_FIXTURE, { storeRoot });

  expect(result.status).toBe("skipped_pending");
  expect(result.contentHash).toBeNull();
  expect(result.objectPath).toBeNull();
  expect(result.diagnostics).toEqual([]);

  const objectsDir = join(storeRoot, "objects", "sha256");
  await expect(stat(objectsDir)).rejects.toMatchObject({ code: "ENOENT" });
});

test("registerTrail on a schema-invalid fixture returns 'invalid' and writes nothing", async () => {
  const result = await registerTrail(SCHEMA_INVALID_FIXTURE, { storeRoot });

  expect(result.status).toBe("invalid");
  expect(result.contentHash).toBeNull();
  expect(result.objectPath).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(
    result.diagnostics.some((d) => d.severity === "error" && d.path === "/schema_version"),
  ).toBe(true);

  const objectsDir = join(storeRoot, "objects", "sha256");
  await expect(stat(objectsDir)).rejects.toMatchObject({ code: "ENOENT" });
});

test("registerTrail on a hash-mismatch fixture returns 'invalid' with a diagnostic and writes nothing", async () => {
  const result = await registerTrail(HASH_MISMATCH_FIXTURE, { storeRoot });

  expect(result.status).toBe("invalid");
  expect(result.contentHash).toBeNull();
  expect(result.objectPath).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.diagnostics[0]).toMatchObject({
    severity: "error",
    code: "content_hash_mismatch",
    line: 1,
    path: "/content_hash",
  });

  const objectsDir = join(storeRoot, "objects", "sha256");
  await expect(stat(objectsDir)).rejects.toMatchObject({ code: "ENOENT" });
});

test("registerTrail writes an index entry keyed by hash with absolute source_path and ISO ts", async () => {
  // Copy the fixture into a separate dir and address it by relative path so we
  // can confirm the index stores the resolved absolute path.
  const inputDir = mkdtempSync(join(tmpdir(), "trail-store-input-"));
  const copied = join(inputDir, "session.trail.jsonl");
  await copyFile(FINALIZED_FIXTURE, copied);
  const relativeInput = relative(process.cwd(), copied);

  const before = Date.now();
  const result = await registerTrail(relativeInput, { storeRoot });
  const after = Date.now();
  expect(result.status).toBe("finalized");

  const indexBytes = await readFile(join(storeRoot, "index", "objects.json"), "utf8");
  const indexValue = JSON.parse(indexBytes) as {
    version: number;
    entries: Record<string, { registered_at: string; source_path: string }>;
  };

  expect(indexValue.version).toBe(1);
  const entry = indexValue.entries[FINALIZED_HASH];
  expect(entry).toBeDefined();
  expect(entry?.source_path).toBe(copied);
  expect(basename(entry?.source_path ?? "")).toBe("session.trail.jsonl");

  const registeredAt = new Date(entry?.registered_at ?? "");
  expect(Number.isNaN(registeredAt.getTime())).toBe(false);
  expect(registeredAt.getTime()).toBeGreaterThanOrEqual(before);
  expect(registeredAt.getTime()).toBeLessThanOrEqual(after);

  rmSync(inputDir, { recursive: true, force: true });
});

test("registerTrail honours opts.sourcePath override (string and null)", async () => {
  const inputDir = mkdtempSync(join(tmpdir(), "trail-store-input-"));
  const copied = join(inputDir, "session.trail.jsonl");
  await copyFile(FINALIZED_FIXTURE, copied);

  const overriddenSource = "https://example.test/some-shared-url";
  const overrideResult = await registerTrail(copied, {
    storeRoot,
    sourcePath: overriddenSource,
  });
  expect(overrideResult.status).toBe("finalized");

  let indexBytes = await readFile(join(storeRoot, "index", "objects.json"), "utf8");
  let indexValue = JSON.parse(indexBytes) as {
    entries: Record<string, { source_path: string | null }>;
  };
  expect(indexValue.entries[FINALIZED_HASH]?.source_path).toBe(overriddenSource);

  const nullResult = await registerTrail(copied, { storeRoot, sourcePath: null });
  expect(nullResult.status).toBe("already_present");

  indexBytes = await readFile(join(storeRoot, "index", "objects.json"), "utf8");
  indexValue = JSON.parse(indexBytes) as {
    entries: Record<string, { source_path: string | null }>;
  };
  expect(indexValue.entries[FINALIZED_HASH]?.source_path).toBeNull();

  rmSync(inputDir, { recursive: true, force: true });
});

test("registerTrail on malformed JSONL returns 'invalid' with a parse diagnostic (does not throw)", async () => {
  const malformedDir = mkdtempSync(join(tmpdir(), "trail-store-malformed-"));
  const path = join(malformedDir, "broken.trail.jsonl");
  await writeFile(path, "{not json\n", "utf8");

  const result = await registerTrail(path, { storeRoot });

  expect(result.status).toBe("invalid");
  expect(result.contentHash).toBeNull();
  expect(result.objectPath).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.diagnostics[0]?.code).toBe("invalid_json");
  expect(result.diagnostics[0]?.line).toBe(1);

  const objectsDir = join(storeRoot, "objects", "sha256");
  await expect(stat(objectsDir)).rejects.toMatchObject({ code: "ENOENT" });

  rmSync(malformedDir, { recursive: true, force: true });
});

test("registerTrail throws IndexCorruptError when index/objects.json is malformed JSON", async () => {
  await mkdir(join(storeRoot, "index"), { recursive: true });
  await writeFile(join(storeRoot, "index", "objects.json"), "{not json", "utf8");

  await expect(registerTrail(FINALIZED_FIXTURE, { storeRoot })).rejects.toBeInstanceOf(
    IndexCorruptError,
  );
});

test("registerTrail throws IndexCorruptError when index/objects.json entries is not a plain object", async () => {
  await mkdir(join(storeRoot, "index"), { recursive: true });
  await writeFile(
    join(storeRoot, "index", "objects.json"),
    `${JSON.stringify({ version: 1, entries: [] })}\n`,
    "utf8",
  );

  await expect(registerTrail(FINALIZED_FIXTURE, { storeRoot })).rejects.toBeInstanceOf(
    IndexCorruptError,
  );
});

test("four concurrent registerTrail calls for distinct hashes produce four index entries", async () => {
  const inputDir = mkdtempSync(join(tmpdir(), "trail-store-concurrent-"));
  const fixtures = await Promise.all(
    [
      "01HSESS00000000000000000AA",
      "01HSESS00000000000000000BB",
      "01HSESS00000000000000000CC",
      "01HSESS00000000000000000DD",
    ].map((id) => writeFinalizedFixture(inputDir, id)),
  );

  const results = await Promise.all(fixtures.map((f) => registerTrail(f.path, { storeRoot })));

  for (const r of results) expect(r.status).toBe("finalized");

  const indexValue = JSON.parse(
    await readFile(join(storeRoot, "index", "objects.json"), "utf8"),
  ) as { entries: Record<string, unknown> };
  expect(Object.keys(indexValue.entries).sort()).toEqual(fixtures.map((f) => f.hash).sort());

  rmSync(inputDir, { recursive: true, force: true });
});

test("registerTrail on a multi-session file writes one row per session + a trail row", async () => {
  const inputDir = mkdtempSync(join(tmpdir(), "trail-msfix-"));
  try {
    const sess1Header = {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000A01",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
      session_uid: "01HSESSXA0000000000000A001",
    };
    const sess1Event = {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hi" },
    };
    const sess2Header = {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000A02",
      ts: "2026-05-17T14:05:00.000Z",
      agent: { name: "claude-code" },
      session_uid: "01HSESSXA0000000000000A002",
    };
    const sess2Event = {
      type: "user_message",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:05:05.000Z",
      payload: { text: "ok" },
    };
    const envelope = {
      type: "trail",
      schema_version: "0.1.0",
      id: "01HTRA0X00000000000000A001",
      ts: "2026-05-17T14:00:00.000Z",
      producer: "trail-cli/0.3.0",
    };
    const { stampTrail } = await import("@agent-trail/core");
    const records = [
      { line: 1, raw: "", value: { ...envelope } },
      { line: 2, raw: "", value: { ...sess1Header } },
      { line: 3, raw: "", value: { ...sess1Event } },
      { line: 4, raw: "", value: { ...sess2Header } },
      { line: 5, raw: "", value: { ...sess2Event } },
    ];
    const stamped = stampTrail(records);
    const bytes = canonicalizeRecords(records);
    const path = join(inputDir, "multi.trail.jsonl");
    await writeFile(path, bytes, "utf8");

    const result = await registerTrail(path, { storeRoot });
    expect(result.status).toBe("finalized");
    expect(result.contentHash).toBe(stamped.envelopeHash as string);

    const indexValue = JSON.parse(
      await readFile(join(storeRoot, "index", "objects.json"), "utf8"),
    ) as { entries: Record<string, { kind?: string; session_uid?: string | null }> };

    const entries = indexValue.entries;
    expect(Object.keys(entries).sort()).toEqual(
      [stamped.envelopeHash as string, ...stamped.sessionHashes].sort(),
    );
    expect(entries[stamped.envelopeHash as string]?.kind).toBe("trail");
    expect(entries[stamped.sessionHashes[0] as string]?.kind).toBe("session");
    expect(entries[stamped.sessionHashes[0] as string]?.session_uid).toBe(
      "01HSESSXA0000000000000A001",
    );
    expect(entries[stamped.sessionHashes[1] as string]?.session_uid).toBe(
      "01HSESSXA0000000000000A002",
    );
  } finally {
    rmSync(inputDir, { recursive: true, force: true });
  }
});

async function writeFinalizedFixture(
  dir: string,
  sessionId: string,
): Promise<{ path: string; hash: string }> {
  const header = {
    type: "session",
    schema_version: "0.1.0",
    id: sessionId,
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  };
  const event = {
    type: "user_message",
    // Derive a per-session event id that satisfies the ULID/UUID id regex by
    // swapping the prefix in a fixed-length canonical ULID. Concatenation
    // (`${sessionId}-evt1`) would produce an invalid compound id.
    id: `01HEVT${sessionId.slice(7, 26)}A`,
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hi" },
  };
  const recordsPending = [
    { line: 1, raw: "", value: header },
    { line: 2, raw: "", value: event },
  ];
  const hash = computeContentHash(recordsPending);
  const recordsFinal = [
    { line: 1, raw: "", value: { ...header, content_hash: hash } },
    { line: 2, raw: "", value: event },
  ];
  const bytes = canonicalizeRecords(recordsFinal);
  const path = join(dir, `${sessionId}.trail.jsonl`);
  await writeFile(path, bytes, "utf8");
  return { path, hash };
}
