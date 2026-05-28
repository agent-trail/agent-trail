import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexAdapter, validateAdapterTrail } from "../index.ts";
import type { AgentMessageUsage } from "../usage.ts";
import { parseCodexJsonl } from "./parser.ts";
import { codexHomeDir, codexSessionsDir } from "./paths.ts";

const DESKTOP_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/codex/desktop-tracer.jsonl", import.meta.url),
);
const REASONING_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/codex/reasoning-dedupe.jsonl", import.meta.url),
);
const COMPACT_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/codex/compact-and-model-change.jsonl", import.meta.url),
);
const APPLY_PATCH_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/codex/apply-patch.jsonl", import.meta.url),
);
const WEB_SEARCH_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/codex/web-search.jsonl", import.meta.url),
);
const LIFECYCLE_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/codex/lifecycle.jsonl", import.meta.url),
);

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

async function parseApplyPatchFixture() {
  return codexAdapter.parseSession({
    id: "019d8600-7777-7000-b000-000000000007",
    adapter: "codex",
    path: APPLY_PATCH_FIXTURE_PATH,
  });
}

async function parseWebSearchFixture() {
  return codexAdapter.parseSession({
    id: "019d8700-8888-7000-c000-000000000008",
    adapter: "codex",
    path: WEB_SEARCH_FIXTURE_PATH,
  });
}

async function parseLifecycleFixture() {
  return codexAdapter.parseSession({
    id: "019d8900-aaaa-7000-e000-00000000000a",
    adapter: "codex",
    path: LIFECYCLE_FIXTURE_PATH,
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
  cliVersion?: string;
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
      cli_version: opts.cliVersion ?? "0.128.0",
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
  const calls = trail.entries.filter((e) => e.type === "tool_call");
  // Desktop fixture emits two tool_calls (`call-abc` shell + `call-exec-1`
  // exec_command); guard against a regression that drops one of them.
  expect(calls.length).toBeGreaterThanOrEqual(2);
  const result = trail.entries.find((e) => e.type === "tool_result");
  const call = calls.find((c) => c.semantic?.call_id === "call-abc");
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

test("exec_command function_call maps to shell_command with workdir as cwd", async () => {
  const trail = await parseDesktopFixture();
  const exec = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-exec-1",
  );
  expect(exec).toBeDefined();
  expect((exec?.payload as { tool: string }).tool).toBe("shell_command");
  const args = (exec?.payload as { args: { command: string; cwd?: string } }).args;
  expect(args.command).toBe("ls -la");
  expect(args.cwd).toBe("/proj/codex-fixture");
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
  // Three entries: turn-1 event_msg.agent_reasoning, turn-2
  // event_msg.agent_reasoning_raw_content, turn-2
  // response_item.reasoning.summary (the dedupe key differs). Look up by
  // audit tag instead of positional index so fixture-order changes don't
  // surface as cryptic index assertion failures.
  expect(thinking).toHaveLength(3);
  const byRawType = (raw: string) => thinking.find((e) => e.meta?.["dev.codex.raw_type"] === raw);
  const reasoning = byRawType("event_msg.agent_reasoning");
  const rawContent = byRawType("event_msg.agent_reasoning_raw_content");
  const summary = byRawType("response_item.reasoning.summary");
  expect(reasoning).toBeDefined();
  expect(rawContent).toBeDefined();
  expect(summary).toBeDefined();
  expect((reasoning?.payload as { text: string }).text).toBe(
    "Step 1: read the file. Step 2: identify duplication.",
  );
  expect((rawContent?.payload as { text: string }).text).toBe("Different turn, different thought.");
  expect((summary?.payload as { text: string }).text).toBe(
    "Summary thought from response_item channel.",
  );
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

test("CODEX_HOME whitespace-only override falls back to default", () => {
  process.env.CODEX_HOME = "   ";
  expect(codexHomeDir()).toBe(join(tmpHome, ".codex"));
});

test("parseSession produces deterministic entry ids across re-parses (spec §8.5)", async () => {
  const a = await parseDesktopFixture();
  const b = await parseDesktopFixture();
  expect(a.header.session_uid).toBe(b.header.session_uid);
  const idsA = a.entries.map((e) => e.id);
  const idsB = b.entries.map((e) => e.id);
  expect(idsA).toEqual(idsB);
  // for_id linkage should also be stable.
  const aResult = a.entries.find((e) => e.type === "tool_result");
  const bResult = b.entries.find((e) => e.type === "tool_result");
  expect((aResult?.payload as { for_id?: string }).for_id).toBe(
    (bResult?.payload as { for_id?: string }).for_id,
  );
});

test("parser preserves unparseable function_call arguments under source.raw", () => {
  const lines = [
    {
      timestamp: "2026-05-28T04:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8200-3333-7000-d000-000000000003",
        timestamp: "2026-05-28T04:00:00.000Z",
        cwd: "/proj/codex-bad-args",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T04:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        arguments: "{not valid json",
        call_id: "call-bad",
      },
    },
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(text);
  const call = trail.entries.find((e) => e.type === "tool_call");
  expect(call).toBeDefined();
  // Unparseable args fall through to `other` via `mapTool` (shell needs a
  // parsed `cmd` to land on shell_command). The raw string is preserved
  // under `source.raw.arguments` so it isn't lost.
  expect((call?.payload as { tool: string }).tool).toBe("other");
  const source = call?.source as Record<string, unknown>;
  const raw = source.raw as Record<string, unknown> | undefined;
  expect(raw?.arguments).toBe("{not valid json");
});

test("event_msg.task_started emits system_event with reserved kind task_started", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.entries.find(
    (e) => e.type === "system_event" && (e.payload as { kind: string }).kind === "task_started",
  );
  expect(evt).toBeDefined();
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;
  expect(data?.turn_id).toBe("turn-life");
  expect(data?.model_context_window).toBe(256000);
  expect(data?.collaboration_mode_kind).toBe("default");
  expect(evt?.meta?.["dev.codex.raw_type"]).toBe("event_msg.task_started");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("event_msg.task_complete emits system_event with canonical task_completed kind", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.entries.find(
    (e) => e.type === "system_event" && (e.payload as { kind: string }).kind === "task_completed",
  );
  expect(evt).toBeDefined();
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;
  expect(data?.turn_id).toBe("turn-life");
  expect(data?.duration_ms).toBe(11000);
  expect(data?.last_agent_message).toBe("done");
  // Raw source payload uses singular `task_complete`; preserve the original
  // wording on the audit tag while the canonical schema kind is `task_completed`.
  expect(evt?.meta?.["dev.codex.raw_type"]).toBe("event_msg.task_complete");
});

test("event_msg.exec_command_end emits x-codex/exec_command_end linked by call_id", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind: string }).kind === "x-codex/exec_command_end",
  );
  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-exec-life");
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;
  expect(data?.exit_code).toBe(0);
  expect(data?.duration_ms).toBe(42);
  expect(data?.command).toBe("ls");
  expect(data?.stdout_excerpt).toBe("file.txt\n");
  expect(data?.stderr_excerpt).toBe("");
});

test("event_msg.patch_apply_end emits x-codex/patch_apply_end linked by call_id", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind: string }).kind === "x-codex/patch_apply_end",
  );
  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-patch-life");
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;
  expect(data?.success).toBe(true);
  expect(data?.changes).toEqual({ "src/x.ts": { type: "modify" } });
});

test("event_msg.mcp_tool_call_end emits x-codex/mcp_tool_call_end linked by call_id", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind: string }).kind === "x-codex/mcp_tool_call_end",
  );
  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-mcp-life");
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;
  expect(data?.plugin_id).toBe("computer-use@openai-bundled");
  expect(data?.duration_ms).toBe(150);
  expect(data?.result_ok).toBe(true);
});

test("event_msg.thread_goal_updated emits x-codex/thread_goal_updated system_event", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind: string }).kind === "x-codex/thread_goal_updated",
  );
  expect(evt).toBeDefined();
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;
  expect(data?.thread_id).toBe("thread-1");
  expect(data?.turn_id).toBe("turn-life");
  expect(data?.goal).toEqual({ summary: "finish the task" });
});

test("tool_search_call + tool_search_output round-trip as other tool_call/result", () => {
  const lines = [
    {
      timestamp: "2026-05-28T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8800-9999-7000-d000-000000000009",
        timestamp: "2026-05-28T10:00:00.000Z",
        cwd: "/proj/codex-toolsearch",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T10:00:01.000Z",
      type: "response_item",
      payload: {
        type: "tool_search_call",
        call_id: "call-toolsearch-1",
        status: "completed",
        execution: "client",
        arguments: JSON.stringify({ query: "diff tools", limit: 5 }),
      },
    },
    {
      timestamp: "2026-05-28T10:00:02.000Z",
      type: "response_item",
      payload: {
        type: "tool_search_output",
        call_id: "call-toolsearch-1",
        status: "completed",
        execution: "client",
        tools: [{ name: "diff" }, { name: "git_diff" }],
      },
    },
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(text);
  const call = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-toolsearch-1",
  );
  const result = trail.entries.find(
    (e) => e.type === "tool_result" && e.semantic?.call_id === "call-toolsearch-1",
  );
  expect(call).toBeDefined();
  expect((call?.payload as { tool: string }).tool).toBe("other");
  const args = (call?.payload as { args: { name: string; args: Record<string, unknown> } }).args;
  expect(args.name).toBe("tool_search");
  expect(args.args.query).toBe("diff tools");
  expect(args.args.limit).toBe(5);
  expect(call?.meta?.["dev.codex.raw_type"]).toBe("response_item.tool_search_call");
  expect(result).toBeDefined();
  expect((result?.payload as { for_id?: string }).for_id).toBe(call?.id);
  expect((result?.payload as { output: string }).output).toContain("diff");
  expect(result?.meta?.["dev.codex.raw_type"]).toBe("response_item.tool_search_output");
});

test("web_search_end emits x-codex/web_search_end system_event with query-based pairing", async () => {
  const trail = await parseWebSearchFixture();
  const evt = trail.entries.find((e) => e.type === "system_event");
  expect(evt).toBeDefined();
  expect((evt?.payload as { kind: string }).kind).toBe("x-codex/web_search_end");
  // Pairing is query-based: tool_call.args.query matches data.query. The
  // source `ws_*` id is preserved under data.call_id for audit fidelity
  // but not surfaced as `semantic.call_id` (no tool_call registered against
  // that id).
  expect(evt?.semantic?.call_id).toBeUndefined();
  const data = (evt?.payload as { data?: { query?: string; call_id?: string } }).data;
  expect(data?.query).toBe("site:example.com api docs");
  expect(data?.call_id).toBe("ws_abc123");
  const call = trail.entries.find((e) => e.type === "tool_call");
  expect((call?.payload as { args: { query: string } }).args.query).toBe(
    "site:example.com api docs",
  );
  expect(evt?.meta?.["dev.codex.raw_type"]).toBe("event_msg.web_search_end");
});

test("web_search_call with action.type='search' maps to tool_call{tool:'web_search'}", async () => {
  const trail = await parseWebSearchFixture();
  const call = trail.entries.find((e) => e.type === "tool_call");
  expect(call).toBeDefined();
  expect((call?.payload as { tool: string }).tool).toBe("web_search");
  expect((call?.payload as { args: { query: string } }).args.query).toBe(
    "site:example.com api docs",
  );
  expect(call?.meta?.["dev.codex.raw_type"]).toBe("response_item.web_search_call");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("custom_tool_call_output emits tool_result paired by call_id", async () => {
  const trail = await parseApplyPatchFixture();
  const singleCall = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-patch-single",
  );
  const singleResult = trail.entries.find(
    (e) => e.type === "tool_result" && e.semantic?.call_id === "call-patch-single",
  );
  expect(singleResult).toBeDefined();
  expect((singleResult?.payload as { for_id?: string }).for_id).toBe(singleCall?.id);
  expect((singleResult?.payload as { output: string }).output).toContain("M src/foo.ts");
  expect(singleResult?.meta?.["dev.codex.raw_type"]).toBe("response_item.custom_tool_call_output");
  const multiResult = trail.entries.find(
    (e) => e.type === "tool_result" && e.semantic?.call_id === "call-patch-multi",
  );
  expect(multiResult).toBeDefined();
});

test("custom_tool_call apply_patch with a multi-file patch falls back to other", async () => {
  const trail = await parseApplyPatchFixture();
  const multi = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-patch-multi",
  );
  expect(multi).toBeDefined();
  expect((multi?.payload as { tool: string }).tool).toBe("other");
  const args = (multi?.payload as { args: { name: string; args: { input: string } } }).args;
  expect(args.name).toBe("apply_patch");
  expect(args.args.input).toContain("*** Update File: src/a.ts");
  expect(args.args.input).toContain("*** Update File: src/b.ts");
});

test("custom_tool_call apply_patch with a single-file patch maps to file_edit", async () => {
  const trail = await parseApplyPatchFixture();
  const single = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-patch-single",
  );
  expect(single).toBeDefined();
  expect((single?.payload as { tool: string }).tool).toBe("file_edit");
  const args = (single?.payload as { args: { path: string; diff: string } }).args;
  expect(args.path).toBe("src/foo.ts");
  expect(args.diff).toContain("*** Update File: src/foo.ts");
  expect(args.diff).toContain("-old line");
  expect(args.diff).toContain("+new line");
  expect(single?.meta?.["dev.codex.raw_type"]).toBe("response_item.custom_tool_call");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("argv-form shell args join to a quoted command string", () => {
  const lines = [
    {
      timestamp: "2026-05-28T06:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8400-5555-7000-f000-000000000005",
        timestamp: "2026-05-28T06:00:00.000Z",
        cwd: "/proj/codex-argv",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T06:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({ command: ["bash", "-lc", "echo hi && ls /tmp"] }),
        call_id: "call-argv-1",
      },
    },
    {
      timestamp: "2026-05-28T06:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ command: "plain string form" }),
        call_id: "call-argv-2",
      },
    },
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(text);
  const argv = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-argv-1",
  );
  const plain = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-argv-2",
  );
  expect(argv).toBeDefined();
  expect((argv?.payload as { tool: string }).tool).toBe("shell_command");
  expect((argv?.payload as { args: { command: string } }).args.command).toBe(
    "bash -lc 'echo hi && ls /tmp'",
  );
  expect(plain).toBeDefined();
  expect((plain?.payload as { tool: string }).tool).toBe("shell_command");
  expect((plain?.payload as { args: { command: string } }).args.command).toBe("plain string form");
});

test("argv-form shell args POSIX-quote single quotes, $VAR, and metacharacters", () => {
  const lines = [
    {
      timestamp: "2026-05-28T13:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8b00-cccc-7000-a100-00000000000c",
        timestamp: "2026-05-28T13:00:00.000Z",
        cwd: "/proj/codex-quote",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T13:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        // Arg with embedded single quote, $VAR expansion intent, and `;` separator.
        arguments: JSON.stringify({ command: ["bash", "-c", "echo 'hi'; echo $USER"] }),
        call_id: "call-quote-1",
      },
    },
    {
      timestamp: "2026-05-28T13:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        // Mixed: one safe identifier, one needing quoting.
        arguments: JSON.stringify({ command: ["grep", "needle*", "/tmp/file with spaces"] }),
        call_id: "call-quote-2",
      },
    },
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(text);
  const q1 = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-quote-1",
  );
  const q2 = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-quote-2",
  );
  expect((q1?.payload as { args: { command: string } }).args.command).toBe(
    `bash -c 'echo '\\''hi'\\''; echo $USER'`,
  );
  expect((q2?.payload as { args: { command: string } }).args.command).toBe(
    `grep 'needle*' '/tmp/file with spaces'`,
  );
});

test("non-string argv element falls back to other rather than silently dropping the arg", () => {
  const lines = [
    {
      timestamp: "2026-05-28T13:30:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8b80-cccc-7000-a200-00000000000d",
        timestamp: "2026-05-28T13:30:00.000Z",
        cwd: "/proj/codex-bad-argv",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T13:30:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        arguments: JSON.stringify({ command: ["echo", 123, "hi"] }),
        call_id: "call-bad-argv",
      },
    },
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(text);
  const call = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-bad-argv",
  );
  // Source fidelity: a non-string argv element refuses canonical
  // `shell_command` reconstruction; the partial argv survives under
  // `other.args.args.command` for downstream inspection.
  expect((call?.payload as { tool: string }).tool).toBe("other");
  const args = (call?.payload as { args: { args: Record<string, unknown> } }).args.args;
  expect(args.command).toEqual(["echo", 123, "hi"]);
});

test("tool_result without matching tool_call omits for_id (orphan path)", () => {
  const lines = [
    {
      timestamp: "2026-05-28T14:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8c00-dddd-7000-b300-00000000000e",
        timestamp: "2026-05-28T14:00:00.000Z",
        cwd: "/proj/codex-orphan",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T14:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-orphan-id",
        output: "stdout from a call we never saw\n",
      },
    },
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(text);
  const result = trail.entries.find((e) => e.type === "tool_result");
  expect(result).toBeDefined();
  // semantic.call_id still preserves the source-side id so consumers can
  // see the orphan, but the canonical for_id pointer is omitted because no
  // tool_call entry was emitted to point at.
  expect(result?.semantic?.call_id).toBe("call-orphan-id");
  expect((result?.payload as { for_id?: string }).for_id).toBeUndefined();
  expect((result?.payload as { output: string }).output).toBe("stdout from a call we never saw\n");
});

test("tool_result output strips trailing spinner glyphs but preserves real content", () => {
  const lines = [
    {
      timestamp: "2026-05-28T12:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8a00-bbbb-7000-f000-00000000000b",
        timestamp: "2026-05-28T12:00:00.000Z",
        cwd: "/proj/codex-spinner",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T12:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "echo hi" }),
        call_id: "call-spin-1",
      },
    },
    {
      timestamp: "2026-05-28T12:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-spin-1",
        // Trailing spinner glyph noise — common in real Codex stdout.
        output: "Exit code: 0\nOutput: foo\n· ",
      },
    },
    {
      timestamp: "2026-05-28T12:00:03.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "echo done" }),
        call_id: "call-spin-2",
      },
    },
    {
      timestamp: "2026-05-28T12:00:04.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-spin-2",
        // Looks spinner-like but is real output — boundary check.
        output: "Done!",
      },
    },
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(text);
  const results = trail.entries.filter((e) => e.type === "tool_result");
  const stripped = results.find((r) => r.semantic?.call_id === "call-spin-1");
  const preserved = results.find((r) => r.semantic?.call_id === "call-spin-2");
  expect((stripped?.payload as { output: string }).output).toBe("Exit code: 0\nOutput: foo");
  expect((preserved?.payload as { output: string }).output).toBe("Done!");
});

test("parser handles sessions with no turn_context (implicit turn id)", () => {
  const lines = [
    {
      timestamp: "2026-05-28T05:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8300-4444-7000-e000-000000000004",
        timestamp: "2026-05-28T05:00:00.000Z",
        cwd: "/proj/codex-implicit-turn",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T05:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "hi" },
    },
    {
      timestamp: "2026-05-28T05:00:02.000Z",
      type: "event_msg",
      payload: { type: "agent_reasoning", text: "thinking once" },
    },
    {
      timestamp: "2026-05-28T05:00:03.000Z",
      type: "event_msg",
      payload: { type: "agent_reasoning", text: "thinking once" },
    },
    {
      timestamp: "2026-05-28T05:00:04.000Z",
      type: "event_msg",
      payload: { type: "agent_message", message: "ok" },
    },
  ];
  const text = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(text);
  const thinking = trail.entries.filter((e) => e.type === "agent_thinking");
  // Implicit-turn dedup still active — duplicate text collapses to one entry.
  expect(thinking).toHaveLength(1);
  expect(trail.entries.find((e) => e.type === "user_message")).toBeDefined();
  expect(trail.entries.find((e) => e.type === "agent_message")).toBeDefined();
});

test("reasoning dedup resets across turn boundary (same text in two turns yields two entries)", () => {
  const text = `Same reasoning text repeated in different turns.`;
  const lines = [
    {
      timestamp: "2026-05-28T07:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8500-6666-7000-a000-000000000006",
        timestamp: "2026-05-28T07:00:00.000Z",
        cwd: "/proj/codex-dedup-boundary",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T07:00:01.000Z",
      type: "turn_context",
      payload: { turn_id: "turn-1", model: "gpt-5-codex" },
    },
    {
      timestamp: "2026-05-28T07:00:02.000Z",
      type: "event_msg",
      payload: { type: "agent_reasoning", text },
    },
    {
      timestamp: "2026-05-28T07:00:03.000Z",
      type: "turn_context",
      payload: { turn_id: "turn-2", model: "gpt-5-codex" },
    },
    {
      timestamp: "2026-05-28T07:00:04.000Z",
      type: "event_msg",
      payload: { type: "agent_reasoning", text },
    },
  ];
  const jsonl = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(jsonl);
  const thinking = trail.entries.filter((e) => e.type === "agent_thinking");
  expect(thinking).toHaveLength(2);
});

test("reasoning entry preserves original whitespace (normalization only for dedup key)", () => {
  const original = "Step 1: read the file.\n  Step 2:  identify  duplication.";
  const lines = [
    {
      timestamp: "2026-05-28T08:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8600-7777-7000-b000-000000000007",
        timestamp: "2026-05-28T08:00:00.000Z",
        cwd: "/proj/codex-reason-fidelity",
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T08:00:01.000Z",
      type: "turn_context",
      payload: { turn_id: "turn-1", model: "gpt-5-codex" },
    },
    {
      timestamp: "2026-05-28T08:00:02.000Z",
      type: "event_msg",
      payload: { type: "agent_reasoning", text: original },
    },
  ];
  const jsonl = `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
  const trail = parseCodexJsonl(jsonl);
  const thinking = trail.entries.find((e) => e.type === "agent_thinking");
  expect((thinking?.payload as { text: string }).text).toBe(original);
});

test("sourceVersion() returns cli_version of the newest seeded session", async () => {
  // Older session carries an older cli_version; newer session carries the
  // current one. Distinct versions assert the mtime-based newest-wins
  // selection directly (a regression that picked the older file would
  // surface as `"0.127.0"`).
  seedSession({
    date: { y: "2026", m: "05", d: "27" },
    id: "019d7a82-b5ce-71e1-b4cf-465a3c310c3f",
    cwd: process.cwd(),
    cliVersion: "0.127.0",
  });
  seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id: "019d7909-85dd-7881-aa12-95ffc8ca8ba1",
    cwd: process.cwd(),
    cliVersion: "0.128.0",
  });
  const version = await codexAdapter.sourceVersion();
  expect(version).toBe("0.128.0");
});

test("sourceVersion() is null when no sessions exist", async () => {
  expect(await codexAdapter.sourceVersion()).toBeNull();
});

test('buildSessionRef sets headerStatus="header" for healthy sessions', async () => {
  seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id: "019d7909-85dd-7881-aa12-95ffc8ca8ba1",
    cwd: process.cwd(),
  });
  const refs = await codexAdapter.detectSessions();
  expect(refs[0]?.headerStatus).toBe("header");
});

test('buildSessionRef sets headerStatus="filename-fallback" when header is unreadable', async () => {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  const dayDir = join(sessionsDir, "2026", "05", "28");
  mkdirSync(dayDir, { recursive: true });
  const id = "019d7909-85dd-7881-aa12-95ffc8ca8ba1";
  const path = join(dayDir, `rollout-2026-05-28T01-46-00-000Z-${id}.jsonl`);
  // Empty file — header read returns undefined, fallback derives id from name.
  writeFileSync(path, "");
  const refs = await codexAdapter.detectSessions({ allCwds: true });
  expect(refs).toHaveLength(1);
  expect(refs[0]?.headerStatus).toBe("filename-fallback");
  expect(refs[0]?.id).toBe(id);
});

function tokenCountSession(
  records: Array<{ type: string; payload: Record<string, unknown> }>,
  meta: { id: string; cwd: string; ts: string } = {
    id: "019d9a00-cccc-7000-a000-00000000000c",
    cwd: "/proj/codex-tokens",
    ts: "2026-05-28T13:00:00.000Z",
  },
): string {
  const lines: Array<Record<string, unknown>> = [
    {
      timestamp: meta.ts,
      type: "session_meta",
      payload: {
        id: meta.id,
        timestamp: meta.ts,
        cwd: meta.cwd,
        originator: "codex-tui",
        cli_version: "0.128.0",
      },
    },
  ];
  let i = 1;
  for (const rec of records) {
    const ts = new Date(new Date(meta.ts).getTime() + i * 1000).toISOString();
    lines.push({ timestamp: ts, type: rec.type, payload: rec.payload });
    i += 1;
  }
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}

test("token_count with info:null leaves agent_message.payload.usage absent", () => {
  const text = tokenCountSession([
    { type: "event_msg", payload: { type: "agent_message", message: "reply" } },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: null,
        rate_limits: { limit_id: "codex", primary: { used_percent: 12, window_minutes: 300 } },
      },
    },
  ]);
  const trail = parseCodexJsonl(text);
  const agent = trail.entries.find((e) => e.type === "agent_message");
  expect(agent).toBeDefined();
  expect((agent?.payload as { usage?: unknown }).usage).toBeUndefined();
});

test("multiple token_counts target the same agent_message — last wins", () => {
  const text = tokenCountSession([
    { type: "event_msg", payload: { type: "agent_message", message: "reply" } },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
          total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
        },
      },
    },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 250, output_tokens: 40, total_tokens: 290 },
          total_token_usage: { input_tokens: 350, output_tokens: 50, total_tokens: 400 },
        },
      },
    },
  ]);
  const trail = parseCodexJsonl(text);
  const agent = trail.entries.find((e) => e.type === "agent_message");
  const usage = (agent?.payload as { usage?: AgentMessageUsage }).usage;
  expect(usage?.input_tokens).toBe(250);
  expect(usage?.output_tokens).toBe(40);
  expect(usage?.input_tokens_cumulative).toBe(350);
  expect(usage?.output_tokens_cumulative).toBe(50);
});

test("token_count without a preceding agent_message is a silent no-op", () => {
  const text = tokenCountSession([
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
          total_token_usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
        },
      },
    },
    { type: "event_msg", payload: { type: "user_message", message: "hi" } },
  ]);
  const trail = parseCodexJsonl(text);
  expect(trail.entries.find((e) => e.type === "agent_message")).toBeUndefined();
  // user_message must not pick up the orphan rollup.
  const user = trail.entries.find((e) => e.type === "user_message");
  expect((user?.payload as { usage?: unknown }).usage).toBeUndefined();
});

test("agent_message without a following token_count emits without payload.usage", () => {
  const text = tokenCountSession([
    { type: "event_msg", payload: { type: "agent_message", message: "no rollup" } },
  ]);
  const trail = parseCodexJsonl(text);
  const agent = trail.entries.find((e) => e.type === "agent_message");
  expect(agent).toBeDefined();
  expect((agent?.payload as { usage?: unknown }).usage).toBeUndefined();
});

test("token_count after a user_message is dropped (does not bind across the user turn)", () => {
  const text = tokenCountSession([
    { type: "event_msg", payload: { type: "agent_message", message: "first reply" } },
    { type: "event_msg", payload: { type: "user_message", message: "follow-up" } },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: 999, output_tokens: 999, total_tokens: 1998 },
          total_token_usage: { input_tokens: 999, output_tokens: 999, total_tokens: 1998 },
        },
      },
    },
  ]);
  const trail = parseCodexJsonl(text);
  const agent = trail.entries.find((e) => e.type === "agent_message");
  expect(agent).toBeDefined();
  // The first agent_message must not pick up the post-user-message
  // token_count — that count belongs to a different (yet-to-arrive)
  // agent_message.
  expect((agent?.payload as { usage?: unknown }).usage).toBeUndefined();
});

test("agent_message followed by token_count rolls up usage with deltas + cumulatives", () => {
  const text = tokenCountSession([
    { type: "event_msg", payload: { type: "user_message", message: "go" } },
    { type: "event_msg", payload: { type: "agent_message", message: "first reply" } },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 18644,
            cached_input_tokens: 5504,
            output_tokens: 481,
            reasoning_output_tokens: 32,
            total_tokens: 19125,
          },
          total_token_usage: {
            input_tokens: 18644,
            cached_input_tokens: 5504,
            output_tokens: 481,
            reasoning_output_tokens: 32,
            total_tokens: 19125,
          },
          model_context_window: 258400,
        },
        rate_limits: null,
      },
    },
  ]);
  const trail = parseCodexJsonl(text);
  const agent = trail.entries.find((e) => e.type === "agent_message");
  expect(agent).toBeDefined();
  const usage = (
    agent?.payload as {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_tokens?: number;
        reasoning_tokens?: number;
        input_tokens_cumulative?: number;
        output_tokens_cumulative?: number;
      };
    }
  ).usage;
  expect(usage).toBeDefined();
  expect(usage?.input_tokens).toBe(18644);
  expect(usage?.output_tokens).toBe(481);
  expect(usage?.cache_read_tokens).toBe(5504);
  expect(usage?.reasoning_tokens).toBe(32);
  expect(usage?.input_tokens_cumulative).toBe(18644);
  expect(usage?.output_tokens_cumulative).toBe(481);
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
