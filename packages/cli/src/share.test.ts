import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  canonicalizeRecords,
  computeContentHash,
  computeTrailEnvelopeContentHash,
  parseJsonlString,
  verifyContentHash,
  verifyTrailEnvelopeContentHash,
} from "@agent-trail/core";
import { runShare } from "./share.ts";

function decodePayload(payload: Uint8Array): string {
  const base64 = Buffer.from(payload).toString("ascii");
  return gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
}

type SeedOpts = {
  agentName?: string;
  cwd?: string;
  id?: string;
  text?: string;
  vcs?: Record<string, unknown>;
};

async function seedTrail(opts: SeedOpts = {}): Promise<{ filePath: string; contentHash: string }> {
  const agentName = opts.agentName ?? "codex-cli";
  const cwd = opts.cwd ?? "/work/proj-a";
  const id = opts.id ?? "01HSESS0000000000000000001";
  const text = opts.text ?? "hello";
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id,
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: agentName },
    cwd,
  };
  if (opts.vcs !== undefined) header.vcs = opts.vcs;
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
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

test("normal mode, confirm accepted: registers, prints summary, uploads and prints viewer URL", async () => {
  const { filePath, contentHash } = await seedTrail();
  const confirmCalls: string[] = [];
  const confirm = async (msg: string): Promise<boolean> => {
    confirmCalls.push(msg);
    return true;
  };
  let uploadCalls = 0;
  const gistUpload = async () => {
    uploadCalls += 1;
    return { gistId: "abc123" };
  };

  const result = await runShare([filePath], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Redaction summary");
  expect(result.stdout).toContain(contentHash.slice(0, 12));
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/abc123");
  expect(result.stdout).not.toContain("Upload pending");
  expect(confirmCalls).toHaveLength(1);
  expect(uploadCalls).toBe(1);
});

test("invalid trail: exits 1 with diagnostics on stderr, no confirm or upload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trail-cli-share-bad-"));
  const badPath = join(dir, "bad.trail.jsonl");
  await writeFile(badPath, "not json\n", "utf8");
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return true;
  };
  let uploadCalled = false;
  const gistUpload = async () => {
    uploadCalled = true;
    return { gistId: "should-not-happen" };
  };

  const result = await runShare([badPath], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.length).toBeGreaterThan(0);
  expect(confirmCalled).toBe(false);
  expect(uploadCalled).toBe(false);
});

test("--skip-redaction --yes: warning still printed, no confirms, uploads and prints viewer URL", async () => {
  const { filePath } = await seedTrail();
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return false;
  };
  const gistUpload = async () => ({ gistId: "skipid" });

  const result = await runShare([filePath, "--skip-redaction", "--yes"], {
    storeRoot,
    confirm,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(confirmCalled).toBe(false);
  expect(result.stderr).toContain("WARNING");
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/skipid");
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
  expect(result.stdout).not.toContain("view/gist/");
});

test("--skip-redaction: stderr warning, two confirms required, both accepted -> uploads and prints viewer URL", async () => {
  const { filePath } = await seedTrail();
  const confirmCalls: string[] = [];
  const confirm = async (msg: string): Promise<boolean> => {
    confirmCalls.push(msg);
    return true;
  };
  const gistUpload = async () => ({ gistId: "twoyes" });

  const result = await runShare([filePath, "--skip-redaction"], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("WARNING");
  expect(result.stderr).toContain("--skip-redaction");
  expect(confirmCalls).toHaveLength(2);
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/twoyes");
  expect(result.stdout).not.toContain("Redaction summary:\n");
});

test("--skip-redaction --yes uploads raw registered object bytes", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { filePath, contentHash } = await seedTrail({ text: `please use key ${fakeKey} now` });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "rawid" };
  };

  const result = await runShare([filePath, "--skip-redaction", "--yes"], {
    storeRoot,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  expect(decoded).toContain(fakeKey);
  expect(decoded).toContain(contentHash);
});

test("upload filename is <short-hash>.trail.jsonl.gz.b64", async () => {
  const { filePath, contentHash } = await seedTrail();
  const captured: { filename?: string } = {};
  const gistUpload = async (_payload: Uint8Array, filename: string) => {
    captured.filename = filename;
    return { gistId: "fnid" };
  };

  const result = await runShare([filePath, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(captured.filename).toBe(`${contentHash.slice(0, 12)}.trail.jsonl.gz.b64`);
});

test("gistUpload failure: exit 1, stderr contains error and gh auth hint, no viewer URL", async () => {
  const { filePath } = await seedTrail();
  const gistUpload = async () => {
    throw new Error("gh: command not found");
  };

  const result = await runShare([filePath, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("gh: command not found");
  expect(result.stderr).toContain("gh auth login");
  expect(result.stdout).not.toContain("view/gist/");
});

test("upload payload is gzipped base64 of the redacted JSONL", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { filePath } = await seedTrail({ text: `please use key ${fakeKey} now` });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "payloadid" };
  };

  const result = await runShare([filePath, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  expect(decoded).not.toContain(fakeKey);
  const records = await parseJsonlString(decoded);
  expect(records.length).toBeGreaterThanOrEqual(2);
  expect(records[0]?.value.type).toBe("session");
});

test("upload payload of redacted-with-secrets trail has a finalized content_hash", async () => {
  const fakeKey = `sk-${"A".repeat(40)}`;
  const { filePath } = await seedTrail({ text: `please use key ${fakeKey} now` });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "hashid" };
  };

  const result = await runShare([filePath, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  const decoded = decodePayload(captured as unknown as Uint8Array);
  const records = await parseJsonlString(decoded);
  const verification = verifyContentHash(records);
  expect(verification.status).toBe("match");
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

test("--dry-run: registers, prints summary, no confirm, no upload", async () => {
  const { filePath } = await seedTrail();
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return true;
  };
  let uploadCalled = false;
  const gistUpload = async () => {
    uploadCalled = true;
    return { gistId: "should-not-happen" };
  };

  const result = await runShare([filePath, "--dry-run"], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(confirmCalled).toBe(false);
  expect(uploadCalled).toBe(false);
  expect(result.stdout).toContain("Redaction summary");
  expect(result.stdout).not.toContain("view/gist/");
});

test("--yes bypasses confirmation and prints viewer URL", async () => {
  const { filePath } = await seedTrail();
  let confirmCalled = false;
  const confirm = async (): Promise<boolean> => {
    confirmCalled = true;
    return false;
  };
  const gistUpload = async () => ({ gistId: "yesid" });

  const result = await runShare([filePath, "--yes"], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(confirmCalled).toBe(false);
  expect(result.stdout).toContain("https://agent-trail.dev/view/gist/yesid");
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

test("normal mode, confirm declined: exits 0 with Share cancelled and no upload", async () => {
  const { filePath } = await seedTrail();
  const confirm = async (): Promise<boolean> => false;
  let uploadCalled = false;
  const gistUpload = async () => {
    uploadCalled = true;
    return { gistId: "should-not-happen" };
  };

  const result = await runShare([filePath], { storeRoot, confirm, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(uploadCalled).toBe(false);
  expect(result.stdout).toContain("Share cancelled");
  expect(result.stdout).not.toContain("view/gist/");
});

test("default share strips vcs.remote_url from uploaded gist and counts it in the summary", async () => {
  const remoteUrl = "https://github.com/agent-trail/agent-trail";
  const { filePath } = await seedTrail({
    vcs: { type: "git", revision: "a1b2c3d4", remote_url: remoteUrl },
  });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "strip-id" };
  };

  const result = await runShare([filePath, "--yes"], { storeRoot, gistUpload });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).not.toContain("--keep-remote-url");
  expect(result.stdout).toContain("vcs_remote_url: 1");
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  expect(decoded).not.toContain(remoteUrl);
});

test("--keep-remote-url preserves vcs.remote_url in the uploaded gist, emits a warning, and suppresses the summary count", async () => {
  const remoteUrl = "https://github.com/agent-trail/agent-trail";
  const { filePath } = await seedTrail({
    vcs: { type: "git", revision: "a1b2c3d4", remote_url: remoteUrl },
  });
  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "keep-id" };
  };

  const result = await runShare([filePath, "--keep-remote-url", "--yes"], {
    storeRoot,
    gistUpload,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("WARNING: --keep-remote-url");
  expect(result.stdout).not.toContain("vcs_remote_url");
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  expect(decoded).toContain(remoteUrl);
});

test("trail with envelope: shared payload carries both session and envelope content_hash", async () => {
  // Seed a trail file that begins with a trail envelope followed by a session
  // header. Both records should end up with a finalized content_hash that
  // verifies against the shared bytes.
  const envelope: Record<string, unknown> = {
    type: "trail",
    schema_version: "0.1.0",
    id: "trl-share-1",
    ts: "2026-05-17T14:00:00.000Z",
    producer: "trail-cli/0.3.0",
  };
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: "sess-share",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
    cwd: "/work/proj-a",
  };
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hello" },
  };
  const draftBytes = `${JSON.stringify(envelope)}\n${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`;
  const draftRecords = await parseJsonlString(draftBytes);
  const sessionHash = computeContentHash(draftRecords);
  header.content_hash = sessionHash;
  const stamped = await parseJsonlString(
    `${JSON.stringify(envelope)}\n${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
  );
  const envelopeHash = computeTrailEnvelopeContentHash(stamped);
  envelope.content_hash = envelopeHash;
  const finalBytes = canonicalizeRecords(
    await parseJsonlString(
      `${JSON.stringify(envelope)}\n${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
    ),
  );

  const dir = mkdtempSync(join(tmpdir(), "trail-cli-share-envelope-"));
  const filePath = join(dir, "session.trail.jsonl");
  await writeFile(filePath, finalBytes, "utf8");

  let captured: Uint8Array | null = null;
  const gistUpload = async (payload: Uint8Array) => {
    captured = payload;
    return { gistId: "envelopeid" };
  };

  const result = await runShare([filePath, "--yes"], { storeRoot, gistUpload });

  if (result.exitCode !== 0) {
    throw new Error(`share failed: ${result.stderr}`);
  }
  expect(captured).not.toBeNull();
  const decoded = decodePayload(captured as unknown as Uint8Array);
  const sharedRecords = await parseJsonlString(decoded);
  expect(sharedRecords[0]?.value.type).toBe("trail");
  expect(sharedRecords[1]?.value.type).toBe("session");
  expect(verifyContentHash(sharedRecords).status).toBe("match");
  expect(verifyTrailEnvelopeContentHash(sharedRecords).status).toBe("match");
});
