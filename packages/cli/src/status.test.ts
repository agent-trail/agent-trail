import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AdapterSourceHealth,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "@agent-trail/adapters";
import { canonicalizeRecords, stampTrail } from "@agent-trail/core";
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

async function seedMultiSessionTrail(storeRoot: string) {
  const inputDir = mkdtempSync(join(tmpdir(), "trail-cli-status-input-"));
  try {
    const records = [
      {
        line: 1,
        raw: "",
        value: {
          type: "trail",
          schema_version: "0.1.0",
          id: "01HTRA0X00000000000000A001",
          ts: "2026-05-17T14:00:00.000Z",
          producer: "trail-cli/0.3.0",
        },
      },
      {
        line: 2,
        raw: "",
        value: {
          type: "session",
          schema_version: "0.1.0",
          id: "01HSESS0000000000000000A01",
          ts: "2026-05-17T14:00:00.000Z",
          agent: { name: "codex-cli" },
          session_uid: "01HSESSXA0000000000000A001",
        },
      },
      {
        line: 3,
        raw: "",
        value: {
          type: "user_message",
          id: "01HEVTA0000000000000000001",
          ts: "2026-05-17T14:00:05.000Z",
          payload: { text: "hello" },
        },
      },
      {
        line: 4,
        raw: "",
        value: {
          type: "session",
          schema_version: "0.1.0",
          id: "01HSESS0000000000000000A02",
          ts: "2026-05-17T14:05:00.000Z",
          agent: { name: "claude-code" },
          session_uid: "01HSESSXA0000000000000A002",
        },
      },
      {
        line: 5,
        raw: "",
        value: {
          type: "user_message",
          id: "01HEVTA0000000000000000002",
          ts: "2026-05-17T14:05:05.000Z",
          payload: { text: "ok" },
        },
      },
    ];
    stampTrail(records);
    const filePath = join(inputDir, "multi.trail.jsonl");
    await writeFile(filePath, canonicalizeRecords(records), "utf8");
    await registerTrail(filePath, { storeRoot });
  } finally {
    rmSync(inputDir, { recursive: true, force: true });
  }
}

test("trail status --json returns grouped cwd, store, config, adapter health, and warnings", async () => {
  const storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-status-store-"));
  try {
    await seedMultiSessionTrail(storeRoot);

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
      entries: 3,
      sessions: 2,
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

test("trail status text escapes terminal control characters", async () => {
  const storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-status-store-"));
  try {
    const result = await runCli(["status"], {
      adapters: [
        fakeAdapter({
          adapter: "codex\ncli",
          path: "/tmp/codex\u001b[2J",
          present: true,
          readable: false,
          sessionCount: 0,
          sourceVersion: null,
          warnings: ["bad\npath\tvalue"],
        }),
      ],
      config: resolvedConfig(),
      projectRoot: "/work/project\nforged",
      storeRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("cwd: /work/project\\nforged");
    expect(result.stdout).toContain("codex\\ncli");
    expect(result.stdout).toContain("/tmp/codex\\u001b[2J");
    expect(result.stdout).toContain("bad\\npath\\tvalue");
    expect(result.stdout).not.toContain("\u001b");
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("trail status --json warns instead of failing when the store index is malformed", async () => {
  const storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-status-store-"));
  try {
    mkdirSync(join(storeRoot, "index"), { recursive: true });
    await writeFile(join(storeRoot, "index", "objects.json"), "{not json", "utf8");

    const result = await runCli(["status", "--json"], {
      adapters: [],
      config: resolvedConfig(),
      projectRoot: "/work/project",
      storeRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as {
      store: { root: string; entries: number; sessions: number; trails: number };
      warnings: string[];
    };
    expect(parsed.store).toEqual({
      root: storeRoot,
      entries: 0,
      sessions: 0,
      trails: 0,
    });
    expect(parsed.warnings[0]).toContain("index/objects.json");
    expect(parsed.warnings[0]).toContain("malformed JSON");
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("trail status text warns instead of failing when the store index is malformed", async () => {
  const storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-status-store-"));
  try {
    mkdirSync(join(storeRoot, "index"), { recursive: true });
    await writeFile(join(storeRoot, "index", "objects.json"), "{not json", "utf8");

    const result = await runCli(["status"], {
      adapters: [],
      config: resolvedConfig(),
      projectRoot: "/work/project",
      storeRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`store: ${storeRoot}`);
    expect(result.stdout).toContain("(0 entries, 0 sessions, 0 trails)");
    expect(result.stdout).toContain("warning: index/objects.json");
    expect(result.stdout).toContain("malformed JSON");
  } finally {
    rmSync(storeRoot, { recursive: true, force: true });
  }
});
