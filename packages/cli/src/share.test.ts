import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalizeRecords, computeContentHash, parseJsonlString } from "@agent-trail/core";
import { runShare } from "./share.ts";

type SeedOpts = {
  agentName?: string;
  cwd?: string;
  id?: string;
  text?: string;
};

async function seedTrail(opts: SeedOpts = {}): Promise<{ filePath: string; contentHash: string }> {
  const agentName = opts.agentName ?? "codex-cli";
  const cwd = opts.cwd ?? "/work/proj-a";
  const id = opts.id ?? "sess1";
  const text = opts.text ?? "hello";
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
    id: "evta1",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text },
  };
  const draftBytes = `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`;
  const draftRecords = await parseJsonlString(draftBytes);
  const contentHash = computeContentHash(draftRecords);
  header.content_hash = contentHash;
  const finalRecords = await parseJsonlString(
    `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
  );
  const canonical = canonicalizeRecords(finalRecords);

  const dir = mkdtempSync(join(tmpdir(), "trail-cli-share-input-"));
  const filePath = join(dir, "session.trail.jsonl");
  await writeFile(filePath, canonical, "utf8");
  return { filePath, contentHash };
}

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-share-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

test("missing path arg: exits 1 with usage on stderr", async () => {
  const result = await runShare([]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Usage: trail share");
});

test("normal mode, confirm accepted: registers, prints summary and upload-pending notice", async () => {
  const { filePath, contentHash } = await seedTrail();
  const confirmCalls: string[] = [];
  const confirm = async (msg: string): Promise<boolean> => {
    confirmCalls.push(msg);
    return true;
  };

  const result = await runShare([filePath], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Redaction summary");
  expect(result.stdout).toContain(contentHash.slice(0, 12));
  expect(result.stdout).toContain("Upload pending");
  expect(confirmCalls).toHaveLength(1);
});

test("invalid trail: exits 1 with diagnostics on stderr, no confirm called", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trail-cli-share-bad-"));
  const badPath = join(dir, "bad.trail.jsonl");
  await writeFile(badPath, "not json\n", "utf8");
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return true;
  };

  const result = await runShare([badPath], { storeRoot, confirm });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.length).toBeGreaterThan(0);
  expect(confirmCalled).toBe(false);
});

test("--skip-redaction --yes: warning still printed, no confirms, upload pending", async () => {
  const { filePath } = await seedTrail();
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return false;
  };

  const result = await runShare([filePath, "--skip-redaction", "--yes"], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(confirmCalled).toBe(false);
  expect(result.stderr).toContain("WARNING");
  expect(result.stdout).toContain("Upload pending");
});

test("--skip-redaction: first confirm yes, second no -> cancelled, no upload pending", async () => {
  const { filePath } = await seedTrail();
  let call = 0;
  const confirm = async (): Promise<boolean> => {
    call += 1;
    return call === 1;
  };

  const result = await runShare([filePath, "--skip-redaction"], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(call).toBe(2);
  expect(result.stderr).toContain("WARNING");
  expect(result.stdout).toContain("Share cancelled");
  expect(result.stdout).not.toContain("Upload pending");
});

test("--skip-redaction: stderr warning, two confirms required, both accepted -> upload pending", async () => {
  const { filePath } = await seedTrail();
  const confirmCalls: string[] = [];
  const confirm = async (msg: string): Promise<boolean> => {
    confirmCalls.push(msg);
    return true;
  };

  const result = await runShare([filePath, "--skip-redaction"], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("WARNING");
  expect(result.stderr).toContain("--skip-redaction");
  expect(confirmCalls).toHaveLength(2);
  expect(result.stdout).toContain("Upload pending");
  expect(result.stdout).not.toContain("Redaction summary:\n");
});

test("redaction summary reports counts for secrets in trail payload", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { filePath } = await seedTrail({ text: `please use key ${fakeKey} now` });

  const result = await runShare([filePath, "--dry-run"], { storeRoot });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Redaction summary");
  expect(result.stdout).toMatch(/openai_api_key:\s*\d+/);
  expect(result.stdout).not.toContain(fakeKey);
});

test("--dry-run: registers, prints summary, no confirm, no upload-pending", async () => {
  const { filePath } = await seedTrail();
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return true;
  };

  const result = await runShare([filePath, "--dry-run"], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(confirmCalled).toBe(false);
  expect(result.stdout).toContain("Redaction summary");
  expect(result.stdout).not.toContain("Upload pending");
});

test("--yes bypasses confirmation, prints upload-pending", async () => {
  const { filePath } = await seedTrail();
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return false;
  };

  const result = await runShare([filePath, "--yes"], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(confirmCalled).toBe(false);
  expect(result.stdout).toContain("Upload pending");
});

test("non-TTY default confirm: throws are caught, cancels with actionable hint to use --yes", async () => {
  const { filePath } = await seedTrail();
  const confirm = async (): Promise<boolean> => {
    throw new ReferenceError("prompt is not defined");
  };

  const result = await runShare([filePath], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Share cancelled");
  expect(result.stderr).toContain("--yes");
});

test("normal mode, confirm declined: exits 0 with Share cancelled and no upload-pending", async () => {
  const { filePath } = await seedTrail();
  const confirm = async (): Promise<boolean> => false;

  const result = await runShare([filePath], { storeRoot, confirm });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Share cancelled");
  expect(result.stdout).not.toContain("Upload pending");
});
