import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterSourceHealth,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "@agent-trail/adapters";
import { claudeCodeAdapter, codexAdapter, piAdapter } from "@agent-trail/adapters";
import pkg from "../package.json" with { type: "json" };
import { runDoctor } from "./doctor.ts";

function mangleClaude(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/[/:]/g, "-");
}

function manglePi(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/^\//, "");
  const inner = normalized.replace(/[/:]/g, "-");
  return `--${inner}--`;
}

type Seed = {
  agent: "claude-code" | "pi" | "codex";
  id: string;
  cwd: string;
  modifiedAt: string;
};

function seedSession(seed: Seed): void {
  let dir: string;
  let filename: string;
  let header: Record<string, unknown>;
  if (seed.agent === "claude-code") {
    const configDir = process.env.CLAUDE_CONFIG_DIR as string;
    dir = join(configDir, "projects", mangleClaude(seed.cwd));
    filename = `${seed.id}.jsonl`;
    header = { type: "session", sessionId: seed.id, cwd: seed.cwd, version: "1.0.0" };
  } else if (seed.agent === "pi") {
    const sessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR as string;
    dir = join(sessionsDir, manglePi(seed.cwd));
    filename = `${seed.id}.jsonl`;
    header = { type: "session", id: seed.id, cwd: seed.cwd, version: 1 };
  } else {
    const codexHome = process.env.CODEX_HOME as string;
    const d = new Date(seed.modifiedAt);
    const y = String(d.getUTCFullYear());
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dir = join(codexHome, "sessions", y, m, dd);
    filename = `rollout-${seed.modifiedAt.replace(/[:.]/g, "-")}-${seed.id}.jsonl`;
    header = {
      timestamp: seed.modifiedAt,
      type: "session_meta",
      payload: {
        id: seed.id,
        timestamp: seed.modifiedAt,
        cwd: seed.cwd,
        originator: "codex_sdk_ts",
        cli_version: "0.98.0",
      },
    };
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, filename);
  writeFileSync(file, `${JSON.stringify(header)}\n`);
  const ts = new Date(seed.modifiedAt);
  utimesSync(file, ts, ts);
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

async function runTrail(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "packages/cli/src/bin.ts", ...args], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

test("doctor --json includes CLI version from the version module", async () => {
  const result = await runDoctor(["--json"], { adapters: [] });

  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout) as {
    status: string;
    checks: Array<{ id: string; status: string; details?: Record<string, unknown> }>;
  };
  expect(parsed.status).toBe("ok");
  expect(parsed.checks.find((check) => check.id === "runtime.cli_version")).toMatchObject({
    status: "ok",
    details: { version: pkg.version },
  });
});

test("doctor --json includes Bun runtime health", async () => {
  const result = await runDoctor(["--json"], { adapters: [], bunVersion: "1.3.11" });

  const parsed = JSON.parse(result.stdout) as {
    checks: Array<{ id: string; status: string; details?: Record<string, unknown> }>;
  };
  expect(parsed.checks.find((check) => check.id === "runtime.bun")).toMatchObject({
    status: "ok",
    details: { version: "1.3.11", minimum: "1.3.11" },
  });
});

test("doctor accepts a v-prefixed Bun runtime version", async () => {
  const result = await runDoctor(["--json"], { adapters: [], bunVersion: "v1.3.11" });

  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout) as {
    checks: Array<{ id: string; status: string; details?: Record<string, unknown> }>;
  };
  expect(parsed.checks.find((check) => check.id === "runtime.bun")).toMatchObject({
    status: "ok",
    details: { version: "v1.3.11", minimum: "1.3.11" },
  });
});

test("doctor exits 1 when redaction smoke check fails", async () => {
  const result = await runDoctor(["--json"], {
    adapters: [],
    redactTrail: () => {
      throw new Error("bad redaction config");
    },
  });

  expect(result.exitCode).toBe(1);
  const parsed = JSON.parse(result.stdout) as {
    status: string;
    checks: Array<{ id: string; status: string; message: string }>;
  };
  expect(parsed.status).toBe("error");
  expect(parsed.checks.find((check) => check.id === "redaction.pipeline")).toMatchObject({
    status: "error",
    message: "redaction pipeline failed: bad redaction config",
  });
});

test("doctor treats missing adapter sources as warnings and exits 0", async () => {
  const result = await runDoctor(["--json"], {
    adapters: [
      fakeAdapter({
        adapter: "codex",
        path: "/missing/.codex/sessions",
        present: false,
        readable: false,
        sessionCount: 0,
        sourceVersion: null,
        warnings: ["source path not found"],
      }),
    ],
  });

  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout) as {
    status: string;
    checks: Array<{ id: string; status: string; details?: Record<string, unknown> }>;
  };
  expect(parsed.status).toBe("warn");
  expect(parsed.checks.find((check) => check.id === "adapter.codex")).toMatchObject({
    status: "warn",
    details: {
      adapter: "codex",
      path: "/missing/.codex/sessions",
      present: false,
      readable: false,
      session_count: 0,
    },
  });
});

test("doctor human output mirrors JSON status words", async () => {
  const result = await runDoctor([], {
    adapters: [
      fakeAdapter({
        adapter: "pi",
        path: "/tmp/pi/sessions",
        present: true,
        readable: true,
        sessionCount: 2,
        sourceVersion: "1",
        warnings: [],
      }),
    ],
    bunVersion: "1.3.11",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("runtime");
  expect(result.stdout).toContain("redaction");
  expect(result.stdout).toContain("adapters");
  expect(result.stdout).toContain("ok  cli version");
  expect(result.stdout).toContain("ok  pi: 2 sessions");
});

test("doctor counts real adapter session sources across all cwds", async () => {
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const prevPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  const prevPiSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  const prevCodexHome = process.env.CODEX_HOME;
  const claudeConfigDir = mkdtempSync(join(tmpdir(), "doctor-claude-"));
  const piSessionsDir = mkdtempSync(join(tmpdir(), "doctor-pi-"));
  const codexHome = mkdtempSync(join(tmpdir(), "doctor-codex-"));
  try {
    process.env.HOME = mkdtempSync(join(tmpdir(), "doctor-home-"));
    delete process.env.USERPROFILE;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    process.env.PI_CODING_AGENT_SESSION_DIR = piSessionsDir;
    process.env.CODEX_HOME = codexHome;
    delete process.env.PI_CODING_AGENT_DIR;

    seedSession({
      agent: "claude-code",
      id: "sess-cc-a",
      cwd: "/tmp/proj/a",
      modifiedAt: "2026-05-17T14:00:00.000Z",
    });
    seedSession({
      agent: "claude-code",
      id: "sess-cc-b",
      cwd: "/tmp/proj/b",
      modifiedAt: "2026-05-18T14:00:00.000Z",
    });
    seedSession({
      agent: "pi",
      id: "sess-pi-a",
      cwd: "/tmp/proj/a",
      modifiedAt: "2026-05-19T14:00:00.000Z",
    });
    seedSession({
      agent: "codex",
      id: "019d9000-3333-7000-a000-000000000003",
      cwd: "/tmp/proj/c",
      modifiedAt: "2026-05-20T14:00:00.000Z",
    });

    const result = await runDoctor(["--json"], {
      adapters: [claudeCodeAdapter, codexAdapter, piAdapter],
    });
    const parsed = JSON.parse(result.stdout) as {
      checks: Array<{ id: string; details?: Record<string, unknown> }>;
    };
    expect(
      parsed.checks.find((check) => check.id === "adapter.claude-code")?.details,
    ).toMatchObject({ session_count: 2 });
    expect(parsed.checks.find((check) => check.id === "adapter.codex")?.details).toMatchObject({
      session_count: 1,
    });
    expect(parsed.checks.find((check) => check.id === "adapter.pi")?.details).toMatchObject({
      session_count: 1,
    });
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevClaudeConfigDir;
    if (prevPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevPiAgentDir;
    if (prevPiSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = prevPiSessionDir;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    rmSync(claudeConfigDir, { recursive: true, force: true });
    rmSync(piSessionsDir, { recursive: true, force: true });
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("trail doctor is wired into the CLI binary", async () => {
  const result = await runTrail(["doctor", "--json"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toHaveProperty("checks");
});
