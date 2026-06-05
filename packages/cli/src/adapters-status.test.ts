import { expect, test } from "bun:test";
import type {
  AdapterSourceHealth,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "@agent-trail/adapters";
import { runCli } from "./cli-runtime.ts";
import type { ResolvedConfig } from "./config.ts";

function resolvedConfig(): ResolvedConfig {
  return {
    config: {
      sources: { defaultFilter: null },
      tui: { previewByteCap: 65_536, previewEventCap: 500 },
      keymap: {},
    },
    sources: [{ layer: "built_in", path: null, status: "default" }],
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

test("trail adapters list --json returns adapter statuses without TUI", async () => {
  const result = await runCli(["adapters", "list", "--json"], {
    adapters: [
      fakeAdapter({
        adapter: "claude-code",
        path: "/tmp/claude/projects",
        present: true,
        readable: true,
        sessionCount: 2,
        sourceVersion: "1.0.0",
        warnings: [],
      }),
    ],
    config: resolvedConfig(),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual([
    {
      adapter: "claude-code",
      status: "ok",
      path: "/tmp/claude/projects",
      present: true,
      readable: true,
      session_count: 2,
      source_version: "1.0.0",
      warnings: [],
    },
  ]);
});

test("trail adapters status --json reports adapter failures as warnings without stack traces", async () => {
  const result = await runCli(["adapters", "status", "--json"], {
    adapters: [throwingAdapter("codex", "permission denied")],
    config: resolvedConfig(),
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout);
  expect(parsed).toEqual([
    {
      adapter: "codex",
      status: "warn",
      path: null,
      present: false,
      readable: false,
      session_count: 0,
      source_version: null,
      warnings: ["health check failed: permission denied"],
    },
  ]);
  expect(result.stdout).not.toContain("Error:");
  expect(result.stdout).not.toContain("at ");
});
