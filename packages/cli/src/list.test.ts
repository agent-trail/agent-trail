import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalizeRecords, computeContentHash, parseJsonlString } from "@agent-trail/core";
import { registerTrail } from "@agent-trail/store";
import { runList } from "./list.ts";

type SeedOpts = {
  agentName?: string;
  cwd?: string;
  id?: string;
};

async function seedTrail(opts: SeedOpts = {}): Promise<{ filePath: string; contentHash: string }> {
  const agentName = opts.agentName ?? "codex-cli";
  const cwd = opts.cwd ?? "/work/proj-a";
  const id = opts.id ?? "01HSESS0000000000000000001";
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id,
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: agentName },
    cwd,
  };
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hello" },
  };
  const draftBytes = `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`;
  const draftRecords = await parseJsonlString(draftBytes);
  const contentHash = computeContentHash(draftRecords);
  header.content_hash = contentHash;
  const finalRecords = await parseJsonlString(
    `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
  );
  const canonical = canonicalizeRecords(finalRecords);

  const dir = mkdtempSync(join(tmpdir(), "trail-cli-list-input-"));
  const filePath = join(dir, "session.trail.jsonl");
  await writeFile(filePath, canonical, "utf8");
  return { filePath, contentHash };
}

async function overrideRegisteredAt(
  storeRoot: string,
  patches: Record<string, string>,
): Promise<void> {
  const indexPath = join(storeRoot, "index", "objects.json");
  const raw = await readFile(indexPath, "utf8");
  const idx = JSON.parse(raw) as {
    version: number;
    entries: Record<string, { registered_at: string; source_path: string | null }>;
  };
  for (const [hash, ts] of Object.entries(patches)) {
    const entry = idx.entries[hash];
    if (entry !== undefined) entry.registered_at = ts;
  }
  await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");
}

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-list-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

test("empty store: exits 0 with empty stdout and stderr", async () => {
  const result = await runList([], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("single registered trail prints one text row with short hash, agent, cwd, registered_at", async () => {
  const { filePath, contentHash } = await seedTrail({
    agentName: "codex-cli",
    cwd: "/work/proj-a",
  });
  const reg = await registerTrail(filePath, { storeRoot });
  expect(reg.status).toBe("finalized");

  const result = await runList([], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const lines = result.stdout.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  const row = lines[0] as string;
  expect(row).toContain(contentHash.slice(0, 12));
  expect(row).toContain("codex-cli");
  expect(row).toContain("/work/proj-a");
  expect(row).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("--json: emits a JSON array of entries with full shape", async () => {
  const { filePath, contentHash } = await seedTrail({
    agentName: "claude-code",
    cwd: "/work/proj-b",
  });
  const reg = await registerTrail(filePath, { storeRoot });
  expect(reg.status).toBe("finalized");

  const result = await runList(["--json"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed).toHaveLength(1);
  expect(parsed[0]).toEqual(
    expect.objectContaining({
      content_hash: contentHash,
      agent: "claude-code",
      cwd: "/work/proj-b",
      source_path: filePath,
    }),
  );
  expect(typeof parsed[0].registered_at).toBe("string");
});

test("sorts by registered_at desc (newest first)", async () => {
  const older = await seedTrail({ id: "01HSESS00000000000000DD0AA", cwd: "/work/old" });
  const newer = await seedTrail({ id: "01HSESS0000000000000NEW0AA", cwd: "/work/new" });
  await registerTrail(older.filePath, { storeRoot });
  await registerTrail(newer.filePath, { storeRoot });
  await overrideRegisteredAt(storeRoot, {
    [older.contentHash]: "2026-01-01T00:00:00.000Z",
    [newer.contentHash]: "2026-02-01T00:00:00.000Z",
  });

  const result = await runList(["--json"], { storeRoot });

  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string }>;
  expect(parsed.map((r) => r.content_hash)).toEqual([newer.contentHash, older.contentHash]);
});

test("--agent filters by exact agent name", async () => {
  const codex = await seedTrail({
    id: "01HSESS0000000000000000AAA",
    agentName: "codex-cli",
    cwd: "/work/a",
  });
  const claude = await seedTrail({
    id: "01HSESS0000000000000000ABB",
    agentName: "claude-code",
    cwd: "/work/b",
  });
  await registerTrail(codex.filePath, { storeRoot });
  await registerTrail(claude.filePath, { storeRoot });

  const result = await runList(["--json", "--agent", "claude-code"], { storeRoot });

  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; agent: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(claude.contentHash);
  expect(parsed[0]?.agent).toBe("claude-code");
});

test("--cwd filters by exact cwd", async () => {
  const a = await seedTrail({ id: "01HSESS0000000000000000AAA", cwd: "/work/proj-a" });
  const b = await seedTrail({ id: "01HSESS0000000000000000ABB", cwd: "/work/proj-b" });
  await registerTrail(a.filePath, { storeRoot });
  await registerTrail(b.filePath, { storeRoot });

  const result = await runList(["--json", "--cwd", "/work/proj-b"], { storeRoot });

  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; cwd: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(b.contentHash);
  expect(parsed[0]?.cwd).toBe("/work/proj-b");
});

test("--since / --until: inclusive lower, exclusive upper bound on registered_at", async () => {
  const t1 = await seedTrail({ id: "01HSESS000000000000000001A", cwd: "/work/1" });
  const t2 = await seedTrail({ id: "01HSESS000000000000000002A", cwd: "/work/2" });
  const t3 = await seedTrail({ id: "01HSESS000000000000000003A", cwd: "/work/3" });
  await registerTrail(t1.filePath, { storeRoot });
  await registerTrail(t2.filePath, { storeRoot });
  await registerTrail(t3.filePath, { storeRoot });
  await overrideRegisteredAt(storeRoot, {
    [t1.contentHash]: "2026-01-01T00:00:00.000Z",
    [t2.contentHash]: "2026-02-01T00:00:00.000Z",
    [t3.contentHash]: "2026-03-01T00:00:00.000Z",
  });

  const result = await runList(
    ["--json", "--since", "2026-02-01T00:00:00.000Z", "--until", "2026-03-01T00:00:00.000Z"],
    { storeRoot },
  );

  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string }>;
  expect(parsed.map((r) => r.content_hash)).toEqual([t2.contentHash]);
});

test("missing object file: warns to stderr, still lists remaining, exit 0", async () => {
  const present = await seedTrail({ id: "01HSESS00000000000000000K0", cwd: "/work/ok" });
  const removed = await seedTrail({ id: "01HSESS00000000000000000RM", cwd: "/work/rm" });
  await registerTrail(present.filePath, { storeRoot });
  const removedReg = await registerTrail(removed.filePath, { storeRoot });
  await unlink(removedReg.objectPath as string);

  const result = await runList(["--json"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain(removed.contentHash);
  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; agent: string | null }>;
  const hashes = parsed.map((r) => r.content_hash).sort();
  expect(hashes).toEqual([present.contentHash, removed.contentHash].sort());
  const removedRow = parsed.find((r) => r.content_hash === removed.contentHash);
  expect(removedRow?.agent).toBeNull();
});

test("unknown flag exits 1 with usage on stderr", async () => {
  const result = await runList(["--nope"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("--nope");
  expect(result.stderr).toContain("Usage: trail list");
});

test("invalid --since exits 1 with stderr message", async () => {
  const result = await runList(["--since", "not-a-date"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("invalid --since");
});

test("invalid --since and --until both reported", async () => {
  const result = await runList(["--since", "bad1", "--until", "bad2"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("invalid --since value: bad1");
  expect(result.stderr).toContain("invalid --until value: bad2");
});

test("corrupt index: exits 1 with friendly stderr (no stack trace)", async () => {
  mkdirSync(join(storeRoot, "index"), { recursive: true });
  await writeFile(join(storeRoot, "index", "objects.json"), "{not json", "utf8");

  const result = await runList([], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("malformed JSON");
  expect(result.stderr).not.toMatch(/\.ts:\d+/);
});

test("malformed index entry (null value): skipped with warning, exit 0", async () => {
  const good = await seedTrail({ id: "01HSESS00000000000000000K0", cwd: "/work/ok" });
  await registerTrail(good.filePath, { storeRoot });
  const indexPath = join(storeRoot, "index", "objects.json");
  const raw = await readFile(indexPath, "utf8");
  const idx = JSON.parse(raw) as { version: number; entries: Record<string, unknown> };
  const badHash = "0".repeat(64);
  idx.entries[badHash] = null;
  await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");

  const result = await runList(["--json"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain(badHash);
  expect(result.stderr).toContain("malformed index entry");
  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string }>;
  expect(parsed.map((r) => r.content_hash)).toEqual([good.contentHash]);
});

test("malformed index key (path traversal): skipped with warning, exit 0", async () => {
  const good = await seedTrail({ id: "01HSESS00000000000000000K0", cwd: "/work/ok" });
  await registerTrail(good.filePath, { storeRoot });
  const indexPath = join(storeRoot, "index", "objects.json");
  const raw = await readFile(indexPath, "utf8");
  const idx = JSON.parse(raw) as {
    version: number;
    entries: Record<string, { registered_at: string; source_path: string | null }>;
  };
  const evilKey = "../../../etc/passwd";
  idx.entries[evilKey] = { registered_at: "2026-01-01T00:00:00.000Z", source_path: null };
  await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");

  const result = await runList(["--json"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("malformed index key");
  expect(result.stderr).toContain(evilKey);
  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string }>;
  expect(parsed.map((r) => r.content_hash)).toEqual([good.contentHash]);
});

test("resolveStoreRoot failure (no HOME, no AGENT_TRAIL_HOME): exit 1 friendly stderr", async () => {
  const savedHome = process.env.HOME;
  const savedTrailHome = process.env.AGENT_TRAIL_HOME;
  process.env.HOME = "";
  process.env.AGENT_TRAIL_HOME = "";
  try {
    const result = await runList([]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("store root");
    expect(result.stderr).not.toMatch(/\.ts:\d+/);
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedTrailHome === undefined) delete process.env.AGENT_TRAIL_HOME;
    else process.env.AGENT_TRAIL_HOME = savedTrailHome;
  }
});

test("non-JSON header line: row included with null agent/cwd, warning on stderr", async () => {
  const { filePath, contentHash } = await seedTrail({
    id: "01HSESS00000000000000BAD00",
    cwd: "/work/bad",
  });
  const reg = await registerTrail(filePath, { storeRoot });
  expect(reg.status).toBe("finalized");
  await writeFile(reg.objectPath as string, "not a json object\n", "utf8");

  const result = await runList(["--json"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain(contentHash);
  const parsed = JSON.parse(result.stdout) as Array<{
    content_hash: string;
    agent: string | null;
    cwd: string | null;
  }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(contentHash);
  expect(parsed[0]?.agent).toBeNull();
  expect(parsed[0]?.cwd).toBeNull();
});
