import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AdapterSourceHealth,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "@agent-trail/adapters";
import { canonicalizeRecords, computeContentHash, parseJsonlString } from "@agent-trail/core";
import { registerTrail } from "@agent-trail/store";
import { runCli } from "./cli-runtime.ts";
import type { ResolvedConfig } from "./config.ts";

function resolvedConfig(): ResolvedConfig {
  return {
    config: {
      sources: { defaultFilter: "pi" },
      tui: { previewByteCap: 2048, previewEventCap: 250 },
      keymap: {},
    },
    sources: [
      { layer: "built_in", path: null, status: "default" },
      { layer: "project_committed", path: "/work/.agent-trail/config.json", status: "loaded" },
    ],
  };
}

function fakeAdapter(health: AdapterSourceHealth): TrailAdapter {
  return {
    name: health.adapter,
    async detectSessions(): Promise<SessionRef[]> {
      return [];
    },
    async parseSession(): Promise<TrailFile> {
      return { groups: [] };
    },
    async isAvailable(): Promise<boolean> {
      return health.present && health.readable;
    },
    async sourceVersion(): Promise<string | null> {
      return health.sourceVersion;
    },
    async sourceHealth(): Promise<AdapterSourceHealth> {
      return health;
    },
  };
}

function throwingAdapter(name: string, message: string): TrailAdapter {
  return {
    name,
    async detectSessions(): Promise<SessionRef[]> {
      return [];
    },
    async parseSession(): Promise<TrailFile> {
      return { groups: [] };
    },
    async isAvailable(): Promise<boolean> {
      return false;
    },
    async sourceVersion(): Promise<string | null> {
      return null;
    },
    async sourceHealth(): Promise<AdapterSourceHealth> {
      throw new Error(message);
    },
  };
}

async function seedTrail(storeRoot: string, opts: { id: string; kind?: "session" | "trail" }) {
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: opts.id,
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
  const draftRecords = await parseJsonlString(
    `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`,
  );
  header.content_hash = computeContentHash(draftRecords);
  const records = await parseJsonlString(`${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`);
  const inputDir = mkdtempSync(join(tmpdir(), "trail-cli-status-input-"));
  const filePath = join(inputDir, `${opts.id}.trail.jsonl`);
  await writeFile(filePath, canonicalizeRecords(records), "utf8");
  const result = await registerTrail(filePath, { storeRoot });
  if (opts.kind === "trail" && result.contentHash !== null) {
    const indexPath = join(storeRoot, "index", "objects.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      entries: Record<string, { kind?: "session" | "trail" }>;
    };
    const entry = index.entries[result.contentHash];
    if (entry !== undefined) entry.kind = "trail";
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }
  rmSync(inputDir, { recursive: true, force: true });
}

test("trail status --json returns grouped cwd, store, config, adapter health, and warnings", async () => {
  const storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-status-store-"));
  try {
    await seedTrail(storeRoot, { id: "01HSESS0000000000000000001", kind: "session" });
    await seedTrail(storeRoot, { id: "01HSESS0000000000000000002", kind: "trail" });

    const result = await runCli(["status", "--json"], {
      adapters: [
        fakeAdapter({
          adapter: "pi",
          path: "/tmp/pi/sessions",
          present: true,
          readable: true,
          sessionCount: 3,
          sourceVersion: "1",
          warnings: [],
        }),
      ],
      config: resolvedConfig(),
      projectRoot: "/work/project",
      storeRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as {
      cwd: string;
      store: { root: string; entries: number; sessions: number; trails: number };
      config: ResolvedConfig;
      adapters: Array<{ adapter: string; status: string; session_count: number }>;
      warnings: string[];
    };
    expect(parsed.cwd).toBe("/work/project");
    expect(parsed.store).toEqual({
      root: storeRoot,
      entries: 2,
      sessions: 1,
      trails: 1,
    });
    expect(parsed.config).toEqual(resolvedConfig());
    expect(parsed.adapters).toEqual([
      expect.objectContaining({
        adapter: "pi",
        status: "ok",
        session_count: 3,
      }),
    ]);
    expect(parsed.warnings).toEqual([]);
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("trail status text reports adapter health failures as stdout warnings without stack traces", async () => {
  const storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-status-store-"));
  try {
    const result = await runCli(["status"], {
      adapters: [throwingAdapter("codex", "permission denied")],
      config: resolvedConfig(),
      projectRoot: "/work/project",
      storeRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("cwd: /work/project");
    expect(result.stdout).toContain("warn  codex: 0 sessions");
    expect(result.stdout).toContain("warning: codex: health check failed: permission denied");
    expect(result.stdout).not.toContain("Error:");
    expect(result.stdout).not.toContain("at ");
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});
