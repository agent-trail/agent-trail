import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAdapter, validateAdapterTrail } from "../index.ts";
import { codexHomeDir, codexSessionsDir } from "./paths.ts";

const DESKTOP_FIXTURE_PATH = new URL(
  "../../tests/fixtures/codex/desktop-tracer.jsonl",
  import.meta.url,
).pathname;
const REASONING_FIXTURE_PATH = new URL(
  "../../tests/fixtures/codex/reasoning-dedupe.jsonl",
  import.meta.url,
).pathname;
const COMPACT_FIXTURE_PATH = new URL(
  "../../tests/fixtures/codex/compact-and-model-change.jsonl",
  import.meta.url,
).pathname;

async function parseDesktopFixture() {
  return codexAdapter.parseSession({
    id: "019d7909-85dd-7881-aa12-95ffc8ca8ba1",
    adapter: "codex",
    path: DESKTOP_FIXTURE_PATH,
  });
}

async function parseReasoningFixture() {
  return codexAdapter.parseSession({
    id: "019d8000-1111-7000-b000-000000000001",
    adapter: "codex",
    path: REASONING_FIXTURE_PATH,
  });
}

async function parseCompactFixture() {
  return codexAdapter.parseSession({
    id: "019d8100-2222-7000-c000-000000000002",
    adapter: "codex",
    path: COMPACT_FIXTURE_PATH,
  });
}

let prevHome: string | undefined;
let prevUserProfile: string | undefined;
let prevCodexHome: string | undefined;
let prevCwd: string;
let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevCodexHome = process.env.CODEX_HOME;
  prevCwd = process.cwd();
  tmpHome = mkdtempSync(join(tmpdir(), "codex-adapter-home-"));
  tmpCwd = mkdtempSync(join(tmpdir(), "codex-adapter-cwd-"));
  process.env.HOME = tmpHome;
  delete process.env.USERPROFILE;
  delete process.env.CODEX_HOME;
  process.chdir(tmpCwd);
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevUserProfile;
  if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = prevCodexHome;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpCwd, { recursive: true, force: true });
});

test("codexAdapter has name 'codex'", () => {
  expect(codexAdapter.name).toBe("codex");
});

test("codexHomeDir defaults to <HOME>/.codex", () => {
  expect(codexHomeDir()).toBe(join(tmpHome, ".codex"));
});

test("codexHomeDir honors CODEX_HOME override", () => {
  process.env.CODEX_HOME = "/tmp/custom-codex";
  expect(codexHomeDir()).toBe("/tmp/custom-codex");
});

test("codexSessionsDir is <codexHome>/sessions", () => {
  expect(codexSessionsDir()).toBe(join(tmpHome, ".codex", "sessions"));
});

test("isAvailable() is false when sessions dir does not exist", async () => {
  expect(await codexAdapter.isAvailable()).toBe(false);
});

test("isAvailable() is true after sessions dir is created", async () => {
  const dir = codexSessionsDir();
  if (dir === undefined) throw new Error("expected sessions dir");
  mkdirSync(dir, { recursive: true });
  expect(await codexAdapter.isAvailable()).toBe(true);
});

function seedSession(opts: {
  date: { y: string; m: string; d: string };
  id: string;
  cwd: string;
  ts?: string;
}): string {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  const dayDir = join(sessionsDir, opts.date.y, opts.date.m, opts.date.d);
  mkdirSync(dayDir, { recursive: true });
  const ts = opts.ts ?? `${opts.date.y}-${opts.date.m}-${opts.date.d}T01:46:00.000Z`;
  const path = join(dayDir, `rollout-${ts.replace(/[:.]/g, "-")}-${opts.id}.jsonl`);
  const sessionMeta = {
    timestamp: ts,
    type: "session_meta",
    payload: {
      id: opts.id,
      timestamp: ts,
      cwd: opts.cwd,
      originator: "codex-tui",
      cli_version: "0.128.0",
      source: "interactive",
      model_provider: "openai",
    },
  };
  writeFileSync(path, `${JSON.stringify(sessionMeta)}\n`);
  return path;
}

test("detectSessions() returns SessionRef for a seeded session matching cwd", async () => {
  const id = "019d7909-85dd-7881-aa12-95ffc8ca8ba1";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
  });
  const refs = await codexAdapter.detectSessions();
  expect(refs).toHaveLength(1);
  const [ref] = refs;
  expect(ref?.id).toBe(id);
  expect(ref?.adapter).toBe("codex");
  expect(ref?.path).toBe(path);
  expect(ref?.cwd).toBe(process.cwd());
  expect(typeof ref?.modifiedAt).toBe("string");
});

test("detectSessions({ allCwds: true }) returns sessions across the entire date tree", async () => {
  seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id: "019d7909-85dd-7881-aa12-95ffc8ca8ba1",
    cwd: "/proj/a",
  });
  seedSession({
    date: { y: "2026", m: "05", d: "27" },
    id: "019d7a82-b5ce-71e1-b4cf-465a3c310c3f",
    cwd: "/proj/b",
  });
  seedSession({
    date: { y: "2026", m: "04", d: "11" },
    id: "019d754e-afa4-7e00-82ae-c65d3a27c9a1",
    cwd: "/proj/c",
  });
  const refs = await codexAdapter.detectSessions({ allCwds: true });
  expect(refs).toHaveLength(3);
  const cwds = refs.map((r) => r.cwd).sort();
  expect(cwds).toEqual(["/proj/a", "/proj/b", "/proj/c"]);
});

test("parseSession on the desktop tracer fixture emits a valid trail with codex-cli header", async () => {
  const trail = await parseDesktopFixture();
  expect(trail.envelope).toBeDefined();
  expect(trail.envelope?.type).toBe("trail");
  expect(trail.envelope?.schema_version).toBe("0.1.0");
  expect(trail.envelope?.producer).toMatch(/^@agent-trail\/adapters-codex\//);
  expect(trail.header.type).toBe("session");
  expect(trail.header.schema_version).toBe("0.1.0");
  expect(trail.header.id).toBe("019d7909-85dd-7881-aa12-95ffc8ca8ba1");
  expect(trail.header.agent.name).toBe("codex-cli");
  expect(trail.header.agent.version).toBe("0.128.0");
  expect(trail.header.cwd).toBe("/proj/codex-fixture");
  expect(typeof trail.header.session_uid).toBe("string");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("desktop fixture emits user_message + agent_message entries from event_msg channel", async () => {
  const trail = await parseDesktopFixture();
  const userEntries = trail.entries.filter((e) => e.type === "user_message");
  const agentEntries = trail.entries.filter((e) => e.type === "agent_message");
  expect(userEntries).toHaveLength(1);
  expect(agentEntries).toHaveLength(1);
  expect((userEntries[0]?.payload as { text: string }).text).toBe("hello codex");
  expect((agentEntries[0]?.payload as { text: string }).text).toBe("hi there");
  expect(userEntries[0]?.meta?.["dev.codex.raw_type"]).toBe("event_msg.user_message");
  expect(agentEntries[0]?.meta?.["dev.codex.raw_type"]).toBe("event_msg.agent_message");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("desktop fixture emits tool_call + tool_result with for_id linkage", async () => {
  const trail = await parseDesktopFixture();
  const call = trail.entries.find((e) => e.type === "tool_call");
  const result = trail.entries.find((e) => e.type === "tool_result");
  expect(call).toBeDefined();
  expect(result).toBeDefined();
  expect((call?.payload as { tool: string }).tool).toBe("shell_command");
  expect((call?.payload as { args: { command: string } }).args.command).toBe("echo hi");
  expect(call?.semantic?.call_id).toBe("call-abc");
  expect((result?.payload as { ok: boolean }).ok).toBe(true);
  expect((result?.payload as { output: string }).output).toBe("hi\n");
  expect((result?.payload as { for_id?: string }).for_id).toBe(call?.id);
  expect(result?.semantic?.call_id).toBe("call-abc");
});

test("compact fixture emits context_compact from top-level compacted record", async () => {
  const trail = await parseCompactFixture();
  const compact = trail.entries.find((e) => e.type === "context_compact");
  expect(compact).toBeDefined();
  expect((compact?.payload as { summary: string }).summary).toBe(
    "Refactored auth module. Tests pass.",
  );
  expect((compact?.payload as { trigger?: string }).trigger).toBe("auto");
  // Real Codex `compacted` records do not carry token counts; the schema
  // optional fields stay absent.
  expect((compact?.payload as { tokens_before?: number }).tokens_before).toBeUndefined();
  expect((compact?.payload as { tokens_after?: number }).tokens_after).toBeUndefined();
  expect(compact?.meta?.["dev.codex.raw_type"]).toBe("compacted");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("compact fixture emits synthesized model_change at the in-session model switch", async () => {
  const trail = await parseCompactFixture();
  const modelChanges = trail.entries.filter((e) => e.type === "model_change");
  expect(modelChanges).toHaveLength(1);
  const [mc] = modelChanges;
  expect((mc?.payload as { from_model?: string; to_model: string }).from_model).toBe("gpt-5-codex");
  expect((mc?.payload as { to_model: string }).to_model).toBe("gpt-5-codex-mini");
  expect(mc?.source?.synthesized).toBe(true);
  expect(mc?.meta?.["dev.codex.raw_type"]).toBe("turn_context.model_change");
});

test("reasoning fixture emits one agent_thinking per turn with dev.codex.raw_type audit tag", async () => {
  const trail = await parseReasoningFixture();
  const thinking = trail.entries.filter((e) => e.type === "agent_thinking");
  expect(thinking).toHaveLength(2);
  expect((thinking[0]?.payload as { text: string }).text).toBe(
    "Step 1: read the file. Step 2: identify duplication.",
  );
  expect(thinking[0]?.meta?.["dev.codex.raw_type"]).toBe("event_msg.agent_reasoning");
  expect((thinking[1]?.payload as { text: string }).text).toBe(
    "Different turn, different thought.",
  );
  expect(thinking[1]?.meta?.["dev.codex.raw_type"]).toBe("event_msg.agent_reasoning_raw_content");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("parseSession throws when the first record is not session_meta", async () => {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  const dayDir = join(sessionsDir, "2026", "05", "28");
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, "rollout-malformed.jsonl");
  writeFileSync(
    path,
    `${JSON.stringify({ type: "event_msg", payload: { type: "task_started" } })}\n`,
  );
  await expect(
    codexAdapter.parseSession({ id: "malformed", adapter: "codex", path }),
  ).rejects.toThrow(/session_meta/);
});

test("detectSessions() filters out sessions whose header cwd differs from caller cwd", async () => {
  seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id: "019d7909-85dd-7881-aa12-95ffc8ca8ba1",
    cwd: process.cwd(),
  });
  seedSession({
    date: { y: "2026", m: "05", d: "27" },
    id: "019d7a82-b5ce-71e1-b4cf-465a3c310c3f",
    cwd: "/somewhere/else",
  });
  const refs = await codexAdapter.detectSessions();
  expect(refs).toHaveLength(1);
  expect(refs[0]?.cwd).toBe(process.cwd());
});
