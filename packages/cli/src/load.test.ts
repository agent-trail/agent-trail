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
