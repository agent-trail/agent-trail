import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { canonicalizeRecords, computeContentHash, parseJsonlString } from "@agent-trail/core";
import type { GistFetch } from "./load.ts";
import { runLoad } from "./load.ts";

type SeedOpts = {
  agentName?: string;
  cwd?: string;
  id?: string;
  text?: string;
  stampHash?: boolean;
  overrideHash?: string;
};

async function seedSharedPayload(
  opts: SeedOpts = {},
): Promise<{ payload: Uint8Array; filename: string; contentHash: string }> {
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
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text },
  };
  const draftBytes = `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`;
  const draftRecords = await parseJsonlString(draftBytes);
  const contentHash = computeContentHash(draftRecords);
  if (opts.stampHash !== false) {
    header.content_hash = opts.overrideHash ?? contentHash;
  }
  const finalRecords = await parseJsonlString(
    `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
  );
  const canonical = canonicalizeRecords(finalRecords);
  const gzipped = gzipSync(Buffer.from(canonical, "utf8"));
  const base64 = gzipped.toString("base64");
  const payload = Buffer.from(base64, "ascii");
  const filename = `${contentHash.slice(0, 12)}.trail.jsonl.gz.b64`;
  return { payload, filename, contentHash };
}

function fakeFetcher(payload: Uint8Array, filename: string): GistFetch {
  return async (_gistId: string) => ({ payload, filename });
}

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-load-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

test("missing url arg: exits 1 with usage on stderr", async () => {
  const result = await runLoad([], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Usage: trail load");
});

test("unsupported URL shape: exits 1 with diagnostic", async () => {
  const result = await runLoad(["https://example.com/not-a-gist"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("unsupported URL");
});

test("bare gist URL accepted", async () => {
  const seed = await seedSharedPayload();
  const url = `https://gist.github.com/someuser/abc123def4567890abcd`;
  const result = await runLoad([url], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(seed.contentHash);
});

test("bare gist id accepted", async () => {
  const seed = await seedSharedPayload();
  const id = "abc123def4567890abcd";
  const result = await runLoad([id], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(seed.contentHash);
});

test("viewer URL: fetches, registers, prints content_hash; object stored under sha256", async () => {
  const seed = await seedSharedPayload();
  const url = `https://agent-trail.dev/view/gist/abc123def4567890abcd`;
  const result = await runLoad([url], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain(seed.contentHash);
  expect(result.stdout).not.toContain(storeRoot);
  const objectPath = join(storeRoot, "objects", "sha256", `${seed.contentHash}.trail.jsonl`);
  expect(existsSync(objectPath)).toBe(true);
});

test("loaded artifact has null source_path in the index (tmp file is deleted)", async () => {
  const seed = await seedSharedPayload();
  const result = await runLoad(["https://agent-trail.dev/view/gist/abc123def4567890abcd"], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(0);
  const indexBytes = await readFile(join(storeRoot, "index", "objects.json"), "utf8");
  const indexValue = JSON.parse(indexBytes) as {
    entries: Record<string, { source_path: string | null }>;
  };
  expect(indexValue.entries[seed.contentHash]?.source_path).toBeNull();
});

test("URL with /raw suffix is accepted", async () => {
  const seed = await seedSharedPayload();
  const url = `https://gist.github.com/someuser/abc123def4567890abcd/raw`;
  const result = await runLoad([url], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(seed.contentHash);
});

test("URL with query string and fragment is accepted", async () => {
  const seed = await seedSharedPayload();
  const url = `https://gist.github.com/abc123def4567890abcd?file=x#L1`;
  const result = await runLoad([url], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(seed.contentHash);
});

test("uppercase hex id rejected", async () => {
  const result = await runLoad(["ABC123DEF4567890ABCD"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unsupported URL");
});

test("non-hex id rejected", async () => {
  const result = await runLoad(["xyz123xyz123xyz123xy"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unsupported URL");
});

test("too-short id rejected", async () => {
  const result = await runLoad(["abc123"], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unsupported URL");
});

test("too-long id rejected", async () => {
  const result = await runLoad(["a".repeat(40)], { storeRoot });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unsupported URL");
});

test("corrupted hash: exits 1 with diagnostic, nothing registered", async () => {
  const wrongHash = "0".repeat(64);
  const seed = await seedSharedPayload({ overrideHash: wrongHash });
  const result = await runLoad(["https://agent-trail.dev/view/gist/abc123"], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr.length).toBeGreaterThan(0);
  const objectPath = join(storeRoot, "objects", "sha256", `${wrongHash}.trail.jsonl`);
  expect(existsSync(objectPath)).toBe(false);
});

test("missing finalized content_hash: exits 1 with spec-referenced message", async () => {
  const seed = await seedSharedPayload({ stampHash: false });
  const result = await runLoad(["https://agent-trail.dev/view/gist/abc123"], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("missing finalized content_hash");
});

test("gistFetch failure: exit 1, stderr contains error and gh auth hint", async () => {
  const failing: GistFetch = async () => {
    throw new Error("gh: command not found");
  };
  const result = await runLoad(["https://agent-trail.dev/view/gist/abc123"], {
    storeRoot,
    gistFetch: failing,
  });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("gh: command not found");
  expect(result.stderr).toContain("gh auth login");
});

test("idempotent: loading same URL twice reports already_present second time", async () => {
  const seed = await seedSharedPayload();
  const url = "https://agent-trail.dev/view/gist/abc123";
  const fetcher = fakeFetcher(seed.payload, seed.filename);

  const first = await runLoad([url], { storeRoot, gistFetch: fetcher });
  expect(first.exitCode).toBe(0);
  expect(first.stdout).toContain("Status: finalized");

  const second = await runLoad([url], { storeRoot, gistFetch: fetcher });
  expect(second.exitCode).toBe(0);
  expect(second.stdout).toContain("Status: already_present");
});

test("no primer/summary output beyond load status lines", async () => {
  const seed = await seedSharedPayload();
  const result = await runLoad(["https://agent-trail.dev/view/gist/abc123"], {
    storeRoot,
    gistFetch: fakeFetcher(seed.payload, seed.filename),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toLowerCase()).not.toContain("primer");
  expect(result.stdout.toLowerCase()).not.toContain("handoff");
  expect(result.stdout.toLowerCase()).not.toContain("summary");
});

test("--out: writes canonical bytes to chosen path matching registered object", async () => {
  const seed = await seedSharedPayload();
  const outDir = mkdtempSync(join(tmpdir(), "trail-load-out-"));
  const outPath = join(outDir, "copy.trail.jsonl");
  try {
    const result = await runLoad(
      [`https://agent-trail.dev/view/gist/abc123def4567890abcd`, "--out", outPath],
      { storeRoot, gistFetch: fakeFetcher(seed.payload, seed.filename) },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Wrote: ${outPath}`);
    const objectPath = join(storeRoot, "objects", "sha256", `${seed.contentHash}.trail.jsonl`);
    const outBytes = await readFile(outPath);
    const objBytes = await readFile(objectPath);
    expect(Buffer.compare(outBytes, objBytes)).toBe(0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("--out to existing file: exits 1 without --force and does not overwrite", async () => {
  const seed = await seedSharedPayload();
  const outDir = mkdtempSync(join(tmpdir(), "trail-load-out-"));
  const outPath = join(outDir, "existing");
  const originalBytes = Buffer.from("DO NOT TOUCH\n", "utf8");
  try {
    await (await import("node:fs/promises")).writeFile(outPath, originalBytes);
    const result = await runLoad(
      [`https://agent-trail.dev/view/gist/abc123def4567890abcd`, "--out", outPath],
      { storeRoot, gistFetch: fakeFetcher(seed.payload, seed.filename) },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--out path exists");
    expect(result.stderr).toContain("--force");
    const after = await readFile(outPath);
    expect(Buffer.compare(after, originalBytes)).toBe(0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("--out --force: overwrites existing file", async () => {
  const seed = await seedSharedPayload();
  const outDir = mkdtempSync(join(tmpdir(), "trail-load-out-"));
  const outPath = join(outDir, "existing");
  try {
    await (await import("node:fs/promises")).writeFile(outPath, "old\n");
    const result = await runLoad(
      [`https://agent-trail.dev/view/gist/abc123def4567890abcd`, "--out", outPath, "--force"],
      { storeRoot, gistFetch: fakeFetcher(seed.payload, seed.filename) },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Wrote: ${outPath}`);
    const objectPath = join(storeRoot, "objects", "sha256", `${seed.contentHash}.trail.jsonl`);
    const outBytes = await readFile(outPath);
    const objBytes = await readFile(objectPath);
    expect(Buffer.compare(outBytes, objBytes)).toBe(0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("--out to a directory: exits 1, no register attempted", async () => {
  const seed = await seedSharedPayload();
  const outDir = mkdtempSync(join(tmpdir(), "trail-load-out-"));
  let fetchCalls = 0;
  const fetcher: GistFetch = async () => {
    fetchCalls += 1;
    return { payload: seed.payload, filename: seed.filename };
  };
  try {
    const result = await runLoad(
      [`https://agent-trail.dev/view/gist/abc123def4567890abcd`, "--out", outDir],
      { storeRoot, gistFetch: fetcher },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("directory");
    expect(fetchCalls).toBe(0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("reconcile: second load with matching session_uid merges segments, summary line emitted", async () => {
  const sessionUid = "01HSESSXD1111111111111111Z";

  // Seg-1: header + user_message, stamped with real content_hash.
  const seg1Header = (content_hash?: string): Record<string, unknown> => {
    const h: Record<string, unknown> = {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      session_uid: sessionUid,
      segment: { seq: 1 },
      ts: "2026-05-26T10:00:00.000Z",
      agent: { name: "codex-cli" },
    };
    if (content_hash !== undefined) h.content_hash = content_hash;
    return h;
  };
  const seg1User = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-26T10:00:05.000Z",
    payload: { text: "hi from seg1" },
  };

  const draft1 = `${JSON.stringify(seg1Header())}\n${JSON.stringify(seg1User)}\n`;
  const seg1Hash = computeContentHash(await parseJsonlString(draft1));
  const seg1Canonical = canonicalizeRecords(
    await parseJsonlString(
      `${JSON.stringify(seg1Header(seg1Hash))}\n${JSON.stringify(seg1User)}\n`,
    ),
  );
  const seg1Payload = Buffer.from(
    gzipSync(Buffer.from(seg1Canonical, "utf8")).toString("base64"),
    "ascii",
  );

  // Seg-2: continuation with valid chain back to seg-1.
  const seg2Header = (content_hash?: string): Record<string, unknown> => {
    const h: Record<string, unknown> = {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000002",
      session_uid: sessionUid,
      segment: { seq: 2, prev_content_hash: seg1Hash },
      ts: "2026-05-26T10:05:00.000Z",
      agent: { name: "codex-cli" },
    };
    if (content_hash !== undefined) h.content_hash = content_hash;
    return h;
  };
  const seg2Agent = {
    type: "agent_message",
    id: "01HEVTA0000000000000000002",
    ts: "2026-05-26T10:05:05.000Z",
    payload: { text: "continuing" },
  };
  const draft2 = `${JSON.stringify(seg2Header())}\n${JSON.stringify(seg2Agent)}\n`;
  const seg2Hash = computeContentHash(await parseJsonlString(draft2));
  const seg2Canonical = canonicalizeRecords(
    await parseJsonlString(
      `${JSON.stringify(seg2Header(seg2Hash))}\n${JSON.stringify(seg2Agent)}\n`,
    ),
  );
  const seg2Payload = Buffer.from(
    gzipSync(Buffer.from(seg2Canonical, "utf8")).toString("base64"),
    "ascii",
  );

  // First load: register seg-1 by itself.
  const first = await runLoad(["https://gist.github.com/u/abc123def4567890abcd"], {
    storeRoot,
    gistFetch: fakeFetcher(seg1Payload, "seg1.trail.jsonl.gz.b64"),
  });
  expect(first.exitCode).toBe(0);
  expect(first.stdout).toContain("Status: finalized");
  // No reconcile on the first segment (no prior match in store).
  expect(first.stdout).not.toContain("Reconciled:");

  // Second load: incoming seg-2 carries matching session_uid → reconciler merges.
  const second = await runLoad(["https://gist.github.com/u/0011223344556677aabb"], {
    storeRoot,
    gistFetch: fakeFetcher(seg2Payload, "seg2.trail.jsonl.gz.b64"),
  });
  expect(second.exitCode).toBe(0);
  expect(second.stdout).toContain("Reconciled: 2 segments");
  expect(second.stdout).toContain(`session_uid ${sessionUid}`);

  // The store now contains a third object: the merged trail. Verify by
  // reading the registered object referenced in the second-load stdout.
  const hashMatch = /Loaded: [0-9a-f]+ \(([0-9a-f]{64})\)/.exec(second.stdout);
  expect(hashMatch).not.toBeNull();
  const mergedHash = (hashMatch ?? [])[1] as string;
  const objectPath = join(storeRoot, "objects", "sha256", `${mergedHash}.trail.jsonl`);
  const mergedBytes = await readFile(objectPath, "utf8");
  const mergedRecords = await parseJsonlString(mergedBytes);
  // Merged header has no segment.* per spec §8.5 step 6.
  const header = mergedRecords[0]?.value as Record<string, unknown>;
  expect(header.segment).toBeUndefined();
  expect(header.session_uid).toBe(sessionUid);
  // ts is preserved from seg-1 (real session start).
  expect(header.ts).toBe("2026-05-26T10:00:00.000Z");
  // Both event ids present.
  const ids = mergedRecords.slice(1).map((r) => (r.value as { id: string }).id);
  expect(ids).toEqual(["01HEVTA0000000000000000001", "01HEVTA0000000000000000002"]);
});
