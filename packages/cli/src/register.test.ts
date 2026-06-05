import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRef, TrailAdapter, TrailFile } from "@agent-trail/adapters";
import {
  canonicalizeRecords,
  computeContentHash,
  parseJsonlString,
  stampTrail,
} from "@agent-trail/core";
import { runCli } from "./cli-runtime.ts";
import { registerFromAdapter, runRegister } from "./register.ts";

type SeedTrailResult = {
  filePath: string;
  contentHash: string;
  trailFile: TrailFile;
};

let storeRoot: string;
let inputRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-register-store-"));
  inputRoot = mkdtempSync(join(tmpdir(), "trail-cli-register-input-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(inputRoot, { recursive: true, force: true });
});

async function seedTrailFile(opts: { id?: string; text?: string } = {}): Promise<SeedTrailResult> {
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: opts.id ?? "01HSESS0000000000000000001",
    session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  };
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: opts.text ?? "hello" },
  };
  const draftRecords = await parseJsonlString(
    `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
  );
  const contentHash = computeContentHash(draftRecords);
  header.content_hash = contentHash;
  const finalRecords = await parseJsonlString(
    `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
  );
  const canonical = canonicalizeRecords(finalRecords);
  const filePath = join(inputRoot, `${header.id}.trail.jsonl`);
  await writeFile(filePath, canonical, "utf8");
  return {
    filePath,
    contentHash,
    trailFile: {
      groups: [
        {
          header: finalRecords[0]!.value as TrailFile["groups"][number]["header"],
          entries: [finalRecords[1]!.value as TrailFile["groups"][number]["entries"][number]],
        },
      ],
    },
  };
}

async function seededStampedTrailFile(): Promise<{ contentHash: string; trailFile: TrailFile }> {
  const records = await parseJsonlString(
    `${JSON.stringify({
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000002",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ02",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "pi" },
      content_hash: "<pending>",
    })}\n${JSON.stringify({
      type: "user_message",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "from adapter" },
    })}\n`,
  );
  const { sessionHashes } = stampTrail(records);
  return {
    contentHash: sessionHashes[0]!,
    trailFile: {
      groups: [
        {
          header: records[0]!.value as TrailFile["groups"][number]["header"],
          entries: [records[1]!.value as TrailFile["groups"][number]["entries"][number]],
        },
      ],
    },
  };
}

function adapterWithSessions(refs: SessionRef[], trailFile: TrailFile): TrailAdapter {
  return {
    name: "pi",
    async detectSessions(opts) {
      expect(opts).toEqual({ allCwds: true });
      return refs;
    },
    async parseSession(ref) {
      expect(ref.id).toBe("sess-target");
      return trailFile;
    },
    async isAvailable() {
      return true;
    },
    async sourceVersion() {
      return null;
    },
    async sourceHealth() {
      return {
        adapter: "pi",
        path: null,
        present: true,
        readable: true,
        sessionCount: refs.length,
        sourceVersion: null,
        warnings: [],
      };
    },
  };
}

test("register help is wired into the CLI", async () => {
  const result = await runCli(["register", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail register [options] <file|adapter:id>");
  expect(result.stdout).toContain("--json");
  expect(result.stdout).toContain("trail register claude-code:abc123");
});

test("file input registers and prints the bare content hash", async () => {
  const { filePath, contentHash } = await seedTrailFile();

  const result = await runRegister({ input: filePath }, { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(`${contentHash}\n`);
});

test("file input with --json prints stable status, hash, and object path", async () => {
  const { filePath, contentHash } = await seedTrailFile();

  const result = await runRegister({ input: filePath, json: true }, { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    status: "finalized",
    content_hash: contentHash,
    object_path: join(storeRoot, "objects", "sha256", `${contentHash}.trail.jsonl`),
  });
});

test("file input with a colon in the path still registers as a file", async () => {
  const { filePath, contentHash } = await seedTrailFile();
  const colonPath = join(inputRoot, "run:1.trail.jsonl");
  await writeFile(colonPath, await readFile(filePath, "utf8"), "utf8");

  const result = await runRegister({ input: colonPath }, { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(`${contentHash}\n`);
});

test("missing file input exits 1 instead of throwing", async () => {
  const result = await runRegister(
    { input: join(inputRoot, "missing.trail.jsonl") },
    { storeRoot },
  );

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("register: ");
  expect(result.stderr).toContain("missing.trail.jsonl");
});

test("registerFromAdapter discovers, parses, canonicalizes, and registers a session ref", async () => {
  const { contentHash, trailFile } = await seededStampedTrailFile();
  const ref = {
    id: "sess-target",
    adapter: "pi",
    path: "/adapter/session.jsonl",
    cwd: "/work/project",
  };

  const result = await registerFromAdapter(ref, {
    adapter: adapterWithSessions([ref], trailFile),
    storeRoot,
  });

  expect(result.status).toBe("finalized");
  expect(result.contentHash).toBe(contentHash);
  expect(result.objectPath).toBe(
    join(storeRoot, "objects", "sha256", `${contentHash}.trail.jsonl`),
  );
  expect(await readFile(result.objectPath!, "utf8")).toBe(
    canonicalizeRecords(
      await parseJsonlString(
        `${JSON.stringify(trailFile.groups[0]!.header)}\n${JSON.stringify(trailFile.groups[0]!.entries[0])}\n`,
      ),
    ),
  );
});

test("registerFromAdapter stamps an unstamped adapter trail before registering", async () => {
  const { trailFile } = await seedTrailFile({
    id: "01HSESS0000000000000000003",
    text: "unstamped adapter output",
  });
  delete (trailFile.groups[0]!.header as { content_hash?: string }).content_hash;
  const ref = {
    id: "sess-target",
    adapter: "pi",
    path: "/adapter/session.jsonl",
    cwd: "/work/project",
  };

  const result = await registerFromAdapter(ref, {
    adapter: adapterWithSessions([ref], trailFile),
    storeRoot,
  });

  expect(result.status).toBe("finalized");
  expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  expect(await readFile(result.objectPath!, "utf8")).toContain(
    `"content_hash":"${result.contentHash}"`,
  );
});

test("adapter ref input registers and prints json through runRegister", async () => {
  const { contentHash, trailFile } = await seededStampedTrailFile();
  const ref = { id: "sess-target", adapter: "pi", path: "/adapter/session.jsonl" };

  const result = await runRegister(
    { input: "pi:sess-target", json: true },
    { storeRoot, adapters: [adapterWithSessions([ref], trailFile)] },
  );

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    status: "finalized",
    content_hash: contentHash,
    object_path: join(storeRoot, "objects", "sha256", `${contentHash}.trail.jsonl`),
  });
});

test("unknown adapter ref exits 1 and lists valid adapter names", async () => {
  const { trailFile } = await seededStampedTrailFile();

  const result = await runRegister(
    { input: "missing:sess-target" },
    { storeRoot, adapters: [adapterWithSessions([], trailFile)] },
  );

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("register: unknown adapter 'missing'");
  expect(result.stderr).toContain("valid adapters: pi");
});

test("known adapter with missing session id exits 1 clearly", async () => {
  const { trailFile } = await seededStampedTrailFile();

  const result = await runRegister(
    { input: "pi:not-here" },
    {
      storeRoot,
      adapters: [
        adapterWithSessions(
          [{ id: "sess-target", adapter: "pi", path: "/adapter/session.jsonl" }],
          trailFile,
        ),
      ],
    },
  );

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("register: no pi session with id 'not-here'");
});

test("known adapter with duplicate session id exits 1 clearly", async () => {
  const { trailFile } = await seededStampedTrailFile();

  const result = await runRegister(
    { input: "pi:sess-target" },
    {
      storeRoot,
      adapters: [
        adapterWithSessions(
          [
            { id: "sess-target", adapter: "pi", path: "/adapter/a.jsonl", cwd: "/work/a" },
            { id: "sess-target", adapter: "pi", path: "/adapter/b.jsonl", cwd: "/work/b" },
          ],
          trailFile,
        ),
      ],
    },
  );

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("register: multiple pi sessions with id 'sess-target'");
});

test("adapter ref ids reserve tilde for future host-qualified refs", async () => {
  const { trailFile } = await seededStampedTrailFile();

  const result = await runRegister(
    { input: "pi:host~sess-target" },
    { storeRoot, adapters: [adapterWithSessions([], trailFile)] },
  );

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("register: '~' is reserved in adapter session refs");
});
