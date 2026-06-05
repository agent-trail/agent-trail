import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRef, TrailAdapter, TrailFile } from "@agent-trail/adapters";
import { runCli } from "./cli-runtime.ts";
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
  agent: "claude-code" | "pi" | "codex" | "opencode";
  id: string;
  cwd: string;
  modifiedAt: string;
  header?: Record<string, unknown>;
};

function seedSession(seed: Seed): string {
  let dir: string;
  let filename: string;
  let header: Record<string, unknown>;
  if (seed.agent === "claude-code") {
    const configDir = process.env.CLAUDE_CONFIG_DIR as string;
    dir = join(configDir, "projects", mangleClaude(seed.cwd));
    filename = `${seed.id}.jsonl`;
    header = seed.header ?? { type: "session", sessionId: seed.id, cwd: seed.cwd };
  } else if (seed.agent === "pi") {
    const sessionsDir = process.env.PI_CODING_AGENT_SESSION_DIR as string;
    dir = join(sessionsDir, manglePi(seed.cwd));
    filename = `${seed.id}.jsonl`;
    header = seed.header ?? { type: "session", sessionId: seed.id, cwd: seed.cwd };
  } else if (seed.agent === "codex") {
    // Codex CLI stores at <CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl.
    // The header is a desktop-wrapped `session_meta` envelope; cwd lives at
    // `payload.cwd`. There is no per-cwd subdir — the adapter filters by
    // reading each file's header cwd.
    const codexHome = process.env.CODEX_HOME as string;
    const d = new Date(seed.modifiedAt);
    const y = String(d.getUTCFullYear());
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dir = join(codexHome, "sessions", y, m, dd);
    filename = `rollout-${seed.modifiedAt.replace(/[:.]/g, "-")}-${seed.id}.jsonl`;
    header = seed.header ?? {
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
  } else {
    const dataDir = process.env.OPENCODE_DATA_DIR as string;
    dir = join(dataDir, "storage", "session", "project-opencode");
    filename = `${seed.id}.json`;
    header = seed.header ?? {
      id: seed.id,
      version: "1.0.153",
      projectID: "project-opencode",
      directory: seed.cwd,
      title: "OpenCode discover",
      time: {
        created: new Date(seed.modifiedAt).getTime(),
        updated: new Date(seed.modifiedAt).getTime(),
      },
    };
  }
  mkdirSync(dir, { recursive: true });
  const file = join(dir, filename);
  writeFileSync(file, `${JSON.stringify(header)}\n`);
  const ts = new Date(seed.modifiedAt);
  utimesSync(file, ts, ts);
  return file;
}

function seedOpenCodeDbSession(seed: { id: string; cwd: string; modifiedAt: string }): string {
  const dbPath = join(opencodeDataDir, "opencode.db");
  const db = new Database(dbPath);
  const updated = new Date(seed.modifiedAt).getTime();
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      directory text NOT NULL,
      title text NOT NULL,
      version text NOT NULL,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    );
  `);
  db.query(
    "INSERT INTO session (id, project_id, directory, title, version, time_created, time_updated) VALUES ($id, 'project-db', $cwd, 'DB OpenCode discover', '1.0.153', $updated, $updated)",
  ).run({ $id: seed.id, $cwd: seed.cwd, $updated: updated });
  db.close();
  return dbPath;
}

let prevHome: string | undefined;
let prevUserProfile: string | undefined;
let prevClaudeConfigDir: string | undefined;
let prevPiAgentDir: string | undefined;
let prevPiSessionDir: string | undefined;
let prevCodexHome: string | undefined;
let prevOpencodeDataDir: string | undefined;
let prevCwd: string;
let claudeConfigDir: string;
let piSessionsDir: string;
let codexHome: string;
let opencodeDataDir: string;
let tmpCwd: string;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  prevPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  prevPiSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  prevCodexHome = process.env.CODEX_HOME;
  prevOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
  prevCwd = process.cwd();
  claudeConfigDir = mkdtempSync(join(tmpdir(), "discover-claude-"));
  piSessionsDir = mkdtempSync(join(tmpdir(), "discover-pi-"));
  codexHome = mkdtempSync(join(tmpdir(), "discover-codex-"));
  opencodeDataDir = mkdtempSync(join(tmpdir(), "discover-opencode-"));
  tmpCwd = mkdtempSync(join(tmpdir(), "discover-cwd-"));
  process.env.HOME = mkdtempSync(join(tmpdir(), "discover-home-"));
  delete process.env.USERPROFILE;
  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
  process.env.PI_CODING_AGENT_SESSION_DIR = piSessionsDir;
  process.env.CODEX_HOME = codexHome;
  process.env.OPENCODE_DATA_DIR = opencodeDataDir;
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
  if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = prevCodexHome;
  if (prevOpencodeDataDir === undefined) delete process.env.OPENCODE_DATA_DIR;
  else process.env.OPENCODE_DATA_DIR = prevOpencodeDataDir;
  rmSync(claudeConfigDir, { recursive: true, force: true });
  rmSync(piSessionsDir, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
  rmSync(opencodeDataDir, { recursive: true, force: true });
  rmSync(tmpCwd, { recursive: true, force: true });
});

test("no sessions: exits 0 with empty stdout and stderr", async () => {
  const result = await runDiscover();
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
  const result = await runDiscover({ json: true });
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
  seedSession({
    agent: "codex",
    id: "019d9000-3333-7000-a000-000000000003",
    cwd: "/tmp/proj/c",
    modifiedAt: "2026-05-19T14:00:00.000Z",
  });
  const result = await runDiscover({ json: true, all: true });
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
    { id: "019d9000-3333-7000-a000-000000000003", adapter: "codex", cwd: "/tmp/proj/c" },
    { id: "sess-cc-a", adapter: "claude-code", cwd: "/tmp/proj/a" },
    { id: "sess-pi-b", adapter: "pi", cwd: "/tmp/proj/b" },
  ]);
});

test("--agent codex finds codex sessions by header cwd", async () => {
  seedSession({
    agent: "codex",
    id: "019d9000-3333-7000-a000-cccccccccccc",
    cwd: tmpCwd,
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
  seedSession({
    agent: "codex",
    id: "019d9001-3333-7000-a000-dddddddddddd",
    cwd: "/somewhere/else",
    modifiedAt: "2026-05-18T14:00:00.000Z",
  });
  const result = await runDiscover({ json: true, agent: "codex" });
  const parsed = JSON.parse(result.stdout) as Array<{ id: string; adapter: string; cwd: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.adapter).toBe("codex");
  expect(parsed[0]?.id).toBe("019d9000-3333-7000-a000-cccccccccccc");
  expect(parsed[0]?.cwd).toBe(tmpCwd);
});

test("--agent opencode finds OpenCode file-storage sessions", async () => {
  seedSession({
    agent: "opencode",
    id: "ses_opencode",
    cwd: tmpCwd,
    modifiedAt: "2026-05-20T14:00:00.000Z",
  });
  const result = await runDiscover({ json: true, agent: "opencode" });
  const parsed = JSON.parse(result.stdout) as Array<{ id: string; adapter: string; cwd: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]).toMatchObject({
    id: "ses_opencode",
    adapter: "opencode",
    cwd: tmpCwd,
  });
});

test("--agent opencode finds SQLite-backed OpenCode sessions", async () => {
  const dbPath = seedOpenCodeDbSession({
    id: "ses_opencode_db",
    cwd: tmpCwd,
    modifiedAt: "2026-05-20T14:00:00.000Z",
  });
  const result = await runDiscover({ json: true, agent: "opencode" });
  const parsed = JSON.parse(result.stdout) as Array<{
    id: string;
    adapter: string;
    cwd: string;
    path: string;
  }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]).toMatchObject({
    id: "ses_opencode_db",
    adapter: "opencode",
    cwd: tmpCwd,
    path: `${dbPath}#ses_opencode_db`,
  });
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
  const result = await runDiscover({ json: true, agent: "pi" });
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
  const result = await runDiscover({ json: true, cwd: "/work/target" });
  const parsed = JSON.parse(result.stdout) as Array<{ id: string; cwd: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.id).toBe("sess-target");
  expect(parsed[0]?.cwd).toBe("/work/target");
});

test("default cwd is matched against header cwd after adapter discovery", async () => {
  const adapter: TrailAdapter = {
    name: "test-adapter",
    async detectSessions() {
      return [
        {
          id: "sess-target",
          adapter: "test-adapter",
          cwd: "/work/target",
          modifiedAt: "2026-05-17T14:00:00.000Z",
        },
        {
          id: "sess-other",
          adapter: "test-adapter",
          cwd: "/work/other",
          modifiedAt: "2026-05-18T14:00:00.000Z",
        },
      ];
    },
    async parseSession(): Promise<TrailFile> {
      throw new Error("not needed");
    },
    async isAvailable() {
      return true;
    },
    async sourceVersion() {
      return null;
    },
    async sourceHealth() {
      return {
        adapter: "test-adapter",
        path: null,
        present: true,
        readable: true,
        sessionCount: 2,
        sourceVersion: null,
        warnings: [],
      };
    },
  };
  const result = await runDiscover({
    adapters: [adapter],
    json: true,
    defaultCwd: "/work/target",
  });
  const parsed = JSON.parse(result.stdout) as Array<{ id: string; cwd: string }>;
  expect(parsed.map((r) => ({ id: r.id, cwd: r.cwd }))).toEqual([
    { id: "sess-target", cwd: "/work/target" },
  ]);
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
  const result = await runDiscover({
    json: true,
    since: "2026-02-01T00:00:00.000Z",
    until: "2026-03-01T00:00:00.000Z",
  });
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
  const result = await runDiscover({ json: true });
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
  const result = await runDiscover();
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
  const result = await runDiscover({ since: "not-a-date" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("invalid --since");
});

test("unknown flag exits 1 with usage on stderr", async () => {
  const result = await runCli(["discover", "--nope"]);
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
    async sourceHealth() {
      return {
        adapter: name,
        path: null,
        present: true,
        readable: true,
        sessionCount: refs.length,
        sourceVersion: null,
        warnings: [],
      };
    },
  };
}

test("--since/--until: rows with undefined modifiedAt are excluded from time-range filter", async () => {
  const adapter = stubAdapter("stub", [
    { id: "sess-dated", adapter: "stub", modifiedAt: "2026-02-15T00:00:00.000Z" },
    { id: "sess-no-mtime", adapter: "stub" },
  ]);
  const result = await runDiscover({
    json: true,
    since: "2026-02-01T00:00:00.000Z",
    until: "2026-03-01T00:00:00.000Z",
    adapters: [adapter],
  });
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
  const result = await runDiscover({ json: true, all: true, agent: "claude-code" });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as Array<{ id: string }>;
  expect(parsed.map((r) => r.id)).toEqual(["sess-real"]);
});
