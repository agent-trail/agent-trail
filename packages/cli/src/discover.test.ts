import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRef, TrailAdapter, TrailFile } from "@agent-trail/adapters";
import { runDiscover } from "./discover.ts";

// Mangling rules mirrored from the adapters so the test seeds the same dirs
// the production code will scan. Kept inline to avoid importing adapter
// internals from the CLI test surface.
function mangleClaude(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/[/:]/g, "-");
}

function manglePi(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/^\//, "");
  const inner = normalized.replace(/[/:]/g, "-");
  return `--${inner}--`;
}

type Seed = {
  agent: "claude-code" | "pi";
  id: string;
  cwd: string;
  modifiedAt: string;
  header?: Record<string, unknown>;
};

function seedSession(seed: Seed): string {
  let dir: string;
  if (seed.agent === "claude-code") {
    const configDir = process.env.CLAUDE_CONFIG_DIR as string;
    dir = join(configDir, "projects", mangleClaude(seed.cwd));
  } else {
    const sessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR as string;
    dir = join(sessionsDir, manglePi(seed.cwd));
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${seed.id}.jsonl`);
  const header = seed.header ?? { type: "session", sessionId: seed.id, cwd: seed.cwd };
  writeFileSync(file, `${JSON.stringify(header)}\n`);
  const ts = new Date(seed.modifiedAt);
  utimesSync(file, ts, ts);
  return file;
}

let prevHome: string | undefined;
let prevUserProfile: string | undefined;
let prevClaudeConfigDir: string | undefined;
let prevPiAgentDir: string | undefined;
let prevPiSessionDir: string | undefined;
let prevCwd: string;
let claudeConfigDir: string;
let piSessionsDir: string;
let tmpCwd: string;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  prevPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  prevPiSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  prevCwd = process.cwd();
  claudeConfigDir = mkdtempSync(join(tmpdir(), "discover-claude-"));
  piSessionsDir = mkdtempSync(join(tmpdir(), "discover-pi-"));
  tmpCwd = mkdtempSync(join(tmpdir(), "discover-cwd-"));
  process.env.HOME = mkdtempSync(join(tmpdir(), "discover-home-"));
  delete process.env.USERPROFILE;
  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  process.env.PI_CODING_AGENT_SESSION_DIR = piSessionsDir;
  delete process.env.PI_CODING_AGENT_DIR;
  process.chdir(tmpCwd);
  // On macOS /tmp resolves through /private — re-read so seed mangling matches
  // what the adapter sees from process.cwd().
  tmpCwd = process.cwd();
});

afterEach(() => {
  process.chdir(prevCwd);
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
  rmSync(claudeConfigDir, { recursive: true, force: true });
  rmSync(piSessionsDir, { recursive: true, force: true });
  rmSync(tmpCwd, { recursive: true, force: true });
});

test("no sessions: exits 0 with empty stdout and stderr", async () => {
  const result = await runDiscover([]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("current cwd: lists only sessions for process.cwd by default", async () => {
  seedSession({
    agent: "claude-code",
    id: "sess-here",
    cwd: tmpCwd,
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
  seedSession({
    agent: "claude-code",
    id: "sess-other",
    cwd: "/tmp/elsewhere",
    modifiedAt: "2026-05-18T14:00:00.000Z",
  });
  const result = await runDiscover(["--json"]);
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
  expect(parsed.map((r) => r.id)).toEqual(["sess-here"]);
});

test("--all walks every project dir across adapters", async () => {
  seedSession({
    agent: "claude-code",
    id: "sess-cc-a",
    cwd: "/tmp/proj/a",
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
  seedSession({
    agent: "pi",
    id: "sess-pi-b",
    cwd: "/tmp/proj/b",
    modifiedAt: "2026-05-18T14:00:00.000Z",
  });
  const result = await runDiscover(["--json", "--all"]);
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout) as Array<{
    id: string;
    adapter: string;
    cwd: string;
  }>;
  const summary = parsed
    .map((r) => ({ id: r.id, adapter: r.adapter, cwd: r.cwd }))
    .sort((a, b) => a.id.localeCompare(b.id));
  expect(summary).toEqual([
    { id: "sess-cc-a", adapter: "claude-code", cwd: "/tmp/proj/a" },
    { id: "sess-pi-b", adapter: "pi", cwd: "/tmp/proj/b" },
  ]);
});

test("--agent filters to a single adapter", async () => {
  seedSession({
    agent: "claude-code",
    id: "sess-cc",
    cwd: tmpCwd,
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
  seedSession({
    agent: "pi",
    id: "sess-pi",
    cwd: tmpCwd,
    modifiedAt: "2026-05-18T14:00:00.000Z",
  });
  const result = await runDiscover(["--json", "--agent", "pi"]);
  const parsed = JSON.parse(result.stdout) as Array<{ id: string; adapter: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.adapter).toBe("pi");
  expect(parsed[0]?.id).toBe("sess-pi");
});

test("--cwd overrides default cwd and is matched against header cwd", async () => {
  seedSession({
    agent: "claude-code",
    id: "sess-target",
    cwd: "/work/target",
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
  const result = await runDiscover(["--json", "--cwd", "/work/target"]);
  const parsed = JSON.parse(result.stdout) as Array<{ id: string; cwd: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.id).toBe("sess-target");
  expect(parsed[0]?.cwd).toBe("/work/target");
});

test("--since / --until: inclusive lower, exclusive upper bound on modifiedAt", async () => {
  seedSession({
    agent: "claude-code",
    id: "sess-jan",
    cwd: tmpCwd,
    modifiedAt: "2026-01-15T00:00:00.000Z",
  });
  seedSession({
    agent: "claude-code",
    id: "sess-feb",
    cwd: tmpCwd,
    modifiedAt: "2026-02-15T00:00:00.000Z",
  });
  seedSession({
    agent: "claude-code",
    id: "sess-mar",
    cwd: tmpCwd,
    modifiedAt: "2026-03-15T00:00:00.000Z",
  });
  const result = await runDiscover([
    "--json",
    "--since",
    "2026-02-01T00:00:00.000Z",
    "--until",
    "2026-03-01T00:00:00.000Z",
  ]);
  const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
  expect(parsed.map((r) => r.id)).toEqual(["sess-feb"]);
});

test("sort: newest-first by modifiedAt, tiebreak by id ascending", async () => {
  seedSession({
    agent: "claude-code",
    id: "sess-a",
    cwd: tmpCwd,
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
  seedSession({
    agent: "claude-code",
    id: "sess-b",
    cwd: tmpCwd,
    modifiedAt: "2026-05-18T14:00:00.000Z",
  });
  const result = await runDiscover(["--json"]);
  const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
  expect(parsed.map((r) => r.id)).toEqual(["sess-b", "sess-a"]);
});

test("text output: one row per session with short id, adapter, cwd, modified_at, path", async () => {
  const path = seedSession({
    agent: "claude-code",
    id: "sess-text-1234567890ab",
    cwd: tmpCwd,
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
  const result = await runDiscover([]);
  expect(result.exitCode).toBe(0);
  const lines = result.stdout.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  const row = lines[0] as string;
  expect(row).toContain("sess-text-12");
  expect(row).toContain("claude-code");
  expect(row).toContain(tmpCwd);
  expect(row).toContain("2026-05-17T14:00:00.000Z");
  expect(row).toContain(path);
});

test("invalid --since exits 1 with stderr message", async () => {
  const result = await runDiscover(["--since", "not-a-date"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("invalid --since");
});

test("unknown flag exits 1 with usage on stderr", async () => {
  const result = await runDiscover(["--nope"]);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("--nope");
  expect(result.stderr).toContain("Usage: trail discover");
});

function stubAdapter(name: string, refs: SessionRef[]): TrailAdapter {
  return {
    name,
    async detectSessions() {
      return refs;
    },
    async parseSession(): Promise<TrailFile> {
      throw new Error("not implemented");
    },
    async isAvailable() {
      return true;
    },
    async sourceVersion() {
      return null;
    },
  };
}

test("--since/--until: rows with undefined modifiedAt are excluded from time-range filter", async () => {
  const adapter = stubAdapter("stub", [
    { id: "sess-dated", adapter: "stub", modifiedAt: "2026-02-15T00:00:00.000Z" },
    { id: "sess-no-mtime", adapter: "stub" },
  ]);
  const result = await runDiscover(
    ["--json", "--since", "2026-02-01T00:00:00.000Z", "--until", "2026-03-01T00:00:00.000Z"],
    { adapters: [adapter] },
  );
  const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
  expect(parsed.map((r) => r.id)).toEqual(["sess-dated"]);
});

test("--all: stray non-directory entries under projects root are ignored", async () => {
  // Seed a real session plus a `.DS_Store`-style stray file at the projects root.
  seedSession({
    agent: "claude-code",
    id: "sess-real",
    cwd: "/tmp/proj-real",
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
  writeFileSync(join(claudeConfigDir, "projects", ".DS_Store"), "not a directory");
  const result = await runDiscover(["--json", "--all", "--agent", "claude-code"]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
  expect(parsed.map((r) => r.id)).toEqual(["sess-real"]);
});
