import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  canonicalizeRecords,
  parseJsonlString,
  stampTrail,
  validateTrailString,
  verifyContentHash,
  verifyTrailEnvelopeContentHash,
} from "@agent-trail/core";
import { readIndex } from "@agent-trail/store";
import { runExport } from "./export.ts";
import type { GistFetch } from "./load.ts";
import { runLoad } from "./load.ts";
import { runShare } from "./share.ts";

const SESSION_UID = "00000000-0000-4000-8000-00000000c001";
const GIST_ID = "abc123def4567890abcd";
const REMOTE_URL = "https://github.com/agent-trail/agent-trail";
const SECRET = `sk-${"A".repeat(40)}`;

let scratchRoot: string;
let shareStoreRoot: string;
let loadStoreRoot: string;

beforeEach(() => {
  scratchRoot = mkdtempSync(join(tmpdir(), "trail-pipeline-scratch-"));
  shareStoreRoot = mkdtempSync(join(tmpdir(), "trail-pipeline-share-store-"));
  loadStoreRoot = mkdtempSync(join(tmpdir(), "trail-pipeline-load-store-"));
});

afterEach(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
  rmSync(shareStoreRoot, { recursive: true, force: true });
  rmSync(loadStoreRoot, { recursive: true, force: true });
});

test("share -> load -> export preserves finalized redacted trail and store metadata", async () => {
  const raw = await seedRawTrail();
  let uploadedPayload: Uint8Array | null = null;
  let uploadedFilename = "";

  const share = await runShare([raw.path, "--yes"], {
    storeRoot: shareStoreRoot,
    gistUpload: async (payload, filename) => {
      uploadedPayload = payload;
      uploadedFilename = filename;
      return { gistId: GIST_ID };
    },
  });

  expect(share.exitCode).toBe(0);
  expect(share.stderr).toBe("");
  if (uploadedPayload === null) {
    throw new Error("share did not upload a payload");
  }
  const payload = uploadedPayload;

  const shareIndex = await readIndex(shareStoreRoot);
  expect(shareIndex.entries[raw.sessionHash]?.kind).toBe("session");
  expect(shareIndex.entries[raw.sessionHash]?.session_uid).toBe(SESSION_UID);
  expect(shareIndex.entries[raw.sessionHash]?.source_path).toBe(resolve(raw.path));
  expect(shareIndex.entries[raw.envelopeHash]?.kind).toBe("trail");
  expect(shareIndex.entries[raw.envelopeHash]?.session_uid).toBeNull();
  expect(shareIndex.entries[raw.envelopeHash]?.source_path).toBe(resolve(raw.path));

  const sharedJsonl = decodePayload(payload);
  expect(sharedJsonl).not.toContain(SECRET);
  expect(sharedJsonl).not.toContain(REMOTE_URL);
  expect(await validateTrailString(sharedJsonl)).toEqual([]);

  const sharedRecords = await parseJsonlString(sharedJsonl);
  expect(verifyContentHash(sharedRecords).status).toBe("match");
  expect(verifyTrailEnvelopeContentHash(sharedRecords).status).toBe("match");
  const sharedEnvelopeHash = (sharedRecords[0]?.value as { content_hash?: string }).content_hash;
  const sharedSessionHash = (sharedRecords[1]?.value as { content_hash?: string }).content_hash;
  if (sharedEnvelopeHash === undefined || sharedSessionHash === undefined) {
    throw new Error("shared payload missing finalized hashes");
  }
  expect(uploadedFilename).toBe(`${sharedEnvelopeHash.slice(0, 12)}.trail.jsonl.gz.b64`);

  const gistFetch: GistFetch = async () => ({
    payload,
    filename: uploadedFilename,
  });
  const load = await runLoad([`https://agent-trail.dev/view/gist/${GIST_ID}`], {
    storeRoot: loadStoreRoot,
    gistFetch,
  });

  expect(load.exitCode).toBe(0);
  expect(load.stderr).toBe("");
  expect(load.stdout).toContain(sharedEnvelopeHash);

  const loadIndex = await readIndex(loadStoreRoot);
  expect(loadIndex.entries[sharedSessionHash]?.kind).toBe("session");
  expect(loadIndex.entries[sharedSessionHash]?.session_uid).toBe(SESSION_UID);
  expect(loadIndex.entries[sharedSessionHash]?.source_path).toBeNull();
  expect(loadIndex.entries[sharedEnvelopeHash]?.kind).toBe("trail");
  expect(loadIndex.entries[sharedEnvelopeHash]?.session_uid).toBeNull();
  expect(loadIndex.entries[sharedEnvelopeHash]?.source_path).toBeNull();

  const exported = await runExport([sharedEnvelopeHash], { storeRoot: loadStoreRoot });
  expect(exported.exitCode).toBe(0);
  expect(exported.stderr).toBe("");
  expect(exported.stdout).toBe(sharedJsonl);

  const stored = await readFile(
    join(loadStoreRoot, "objects", "sha256", `${sharedEnvelopeHash}.trail.jsonl`),
    "utf8",
  );
  expect(stored).toBe(sharedJsonl);
});

async function seedRawTrail(): Promise<{
  path: string;
  sessionHash: string;
  envelopeHash: string;
}> {
  const records = await parseJsonlString(
    [
      JSON.stringify({
        type: "trail",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-00000000d001",
        ts: "2026-06-02T09:59:59.000Z",
        producer: "trail-test/0.0.0",
        vcs: { type: "git", revision: "abc123", remote_url: REMOTE_URL },
      }),
      JSON.stringify({
        type: "session",
        schema_version: "0.1.0",
        id: "00000000-0000-4000-8000-00000000d002",
        session_uid: SESSION_UID,
        ts: "2026-06-02T10:00:00.000Z",
        agent: { name: "codex-cli" },
        cwd: "/workspace/agent-trail-synthetic",
        vcs: { type: "git", revision: "abc123", remote_url: REMOTE_URL },
      }),
      JSON.stringify({
        type: "user_message",
        id: "00000000-0000-4000-8000-00000000d003",
        ts: "2026-06-02T10:00:01.000Z",
        payload: { text: `use ${SECRET} for this synthetic test` },
      }),
      JSON.stringify({
        type: "agent_message",
        id: "00000000-0000-4000-8000-00000000d004",
        parent_id: "00000000-0000-4000-8000-00000000d003",
        ts: "2026-06-02T10:00:02.000Z",
        payload: { text: "done" },
      }),
    ].join("\n"),
  );
  const stamped = stampTrail(records);
  if (stamped.envelopeHash === null || stamped.sessionHashes[0] === undefined) {
    throw new Error("seed trail did not stamp hashes");
  }
  const path = join(scratchRoot, "raw.trail.jsonl");
  await writeFile(path, canonicalizeRecords(records), "utf8");
  return { path, sessionHash: stamped.sessionHashes[0], envelopeHash: stamped.envelopeHash };
}

function decodePayload(payload: Uint8Array): string {
  const base64 = Buffer.from(payload).toString("ascii");
  return gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
}
