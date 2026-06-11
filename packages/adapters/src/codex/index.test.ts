import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { codexAdapter, validateAdapterTrail } from "../index.ts";
import { CODEX_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import { mapTool, patchFiles } from "./parser.ts";
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

test("parseSession summarizes clean parse fidelity on the header", async () => {
  const trail = await parseDesktopFixture();
  expect(trail.groups[0]!.header.parse_fidelity).toEqual({ quarantined_count: 0 });
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
  extraPayload?: Record<string, unknown>;
  extraRecords?: Record<string, unknown>[];
  lineEnding?: string;
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
      ...opts.extraPayload,
    },
  };
  const records = [sessionMeta, ...(opts.extraRecords ?? [])];
  const lineEnding = opts.lineEnding ?? "\n";
  writeFileSync(
    path,
    `${records.map((record) => JSON.stringify(record)).join(lineEnding)}${lineEnding}`,
  );
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
  expect(trail.groups[0]!.header.type).toBe("session");
  expect(trail.groups[0]!.header.schema_version).toBe("0.1.0");
  expect(trail.groups[0]!.header.id).toBe("019d7909-85dd-7881-aa12-95ffc8ca8ba1");
  expect(trail.groups[0]!.header.agent.name).toBe("codex-cli");
  expect(trail.groups[0]!.header.agent.version).toBe("0.128.0");
  expect(trail.groups[0]!.header.cwd).toBe("/proj/codex-fixture");
  expect(typeof trail.groups[0]!.header.session_uid).toBe("string");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("parseSession canonicalizes UUID source ids before emission", async () => {
  const sourceId = "019D7909-85DD-7881-AA12-95FFC8CA8BA1";
  const canonicalId = "019d7909-85dd-7881-aa12-95ffc8ca8ba1";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id: sourceId,
    cwd: process.cwd(),
  });

  const trail = await codexAdapter.parseSession({ id: sourceId, adapter: "codex", path });

  expect(trail.groups[0]!.header.id).toBe(canonicalId);
  expect(trail.groups[0]!.header.session_uid).toBe(
    deriveSessionUid(CODEX_SESSION_UID_NAMESPACE, canonicalId),
  );
  expect(await validateAdapterTrail(trail)).toEqual([]);
});

test("parseSession emits trimmed session_metadata_update name from CRLF session_index thread_name", async () => {
  const id = "019d7909-85dd-7881-aa12-95ffc8ca8ba1";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
  });
  const codexHome = codexHomeDir();
  if (codexHome === undefined) throw new Error("expected codex home");
  writeFileSync(
    join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id: "other", thread_name: "Other", updated_at: "2026-06-02T04:50:00.000000Z" })}\r\n${JSON.stringify(
      {
        id,
        thread_name: "  Address TDD #125  ",
        updated_at: "2026-06-02T04:51:00.000000Z",
      },
    )}\r\n`,
  );

  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const update = trail.groups[0]!.entries.find(
    (entry) => entry.type === "session_metadata_update" && entry.payload?.field === "name",
  );

  expect(trail.groups[0]!.header.name).toBe("Address TDD #125");
  expect(update?.ts).toBe("2026-06-02T04:51:00.000Z");
  expect(update?.payload).toEqual({
    field: "name",
    value: "Address TDD #125",
    reason: "external",
  });
  expect(update?.source).toEqual({
    agent: "codex-cli",
    original_type: "session_index",
    synthesized: true,
    raw: {
      id,
      thread_name: "  Address TDD #125  ",
      updated_at: "2026-06-02T04:51:00.000000Z",
    },
  });
  expect(await validateAdapterTrail(trail)).toEqual([]);
});

test("parseSession sanitizes session_index source raw", async () => {
  const id = "019d7909-85dd-7881-aa12-95ffc8ca8ba1";
  const fakeSecret = "TEST_SECRET=not-real-placeholder-123456";
  const hugeDebug = "x".repeat(40_000);
  const previousHardCap = process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP;
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
  });
  const codexHome = codexHomeDir();
  if (codexHome === undefined) throw new Error("expected codex home");
  writeFileSync(
    join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({
      id,
      thread_name: "  Safe session title  ",
      updated_at: "2026-06-02T04:51:00.000000Z",
      env: { SESSION_SECRET: fakeSecret },
      debug: hugeDebug,
    })}\n`,
  );

  process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP = "32768";
  try {
    const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
    const update = trail.groups[0]!.entries.find(
      (entry) => entry.type === "session_metadata_update" && entry.payload?.field === "name",
    );
    const raw = update?.source?.raw as
      | { env?: { SESSION_SECRET?: unknown }; debug?: unknown }
      | undefined;

    expect(update?.payload).toEqual({
      field: "name",
      value: "Safe session title",
      reason: "external",
    });
    expect(raw?.env?.SESSION_SECRET).toBe("[CREDENTIAL_VALUE]");
    expect(raw?.debug).toEqual({ elided: true, size_bytes: hugeDebug.length });
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    if (previousHardCap === undefined) {
      delete process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP;
    } else {
      process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP = previousHardCap;
    }
  }
});

test("parseSession skips session_index rows without usable thread_name", async () => {
  const id = "019d7909-85dd-7881-aa12-95ffc8ca8ba1";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
  });
  const codexHome = codexHomeDir();
  if (codexHome === undefined) throw new Error("expected codex home");
  writeFileSync(
    join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({ id, thread_name: "", updated_at: "2026-06-02T04:51:00.000000Z" })}\n`,
  );

  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });

  expect(
    trail.groups[0]!.entries.some(
      (entry) => entry.type === "session_metadata_update" && entry.payload?.field === "name",
    ),
  ).toBe(false);
});

test("parseSession tolerates CRLF blank lines in session JSONL", async () => {
  const id = "019d7909-85dd-7881-aa12-95ffc8ca8ba2";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    lineEnding: "\r\n",
  });

  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });

  expect(trail.groups[0]?.header.id).toBe(id);
  expect(await validateAdapterTrail(trail)).toEqual([]);
});

test("desktop fixture emits user_message + agent_message entries from event_msg channel", async () => {
  const trail = await parseDesktopFixture();
  const userEntries = trail.groups[0]!.entries.filter((e) => e.type === "user_message");
  const agentEntries = trail.groups[0]!.entries.filter((e) => e.type === "agent_message");
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
  const calls = trail.groups[0]!.entries.filter((e) => e.type === "tool_call");
  // Desktop fixture emits two tool_calls (`call-abc` shell + `call-exec-1`
  // exec_command); guard against a regression that drops one of them.
  expect(calls.length).toBeGreaterThanOrEqual(2);
  const result = trail.groups[0]!.entries.find((e) => e.type === "tool_result");
  const call = calls.find((c) => c.semantic?.call_id === "call-abc");
  expect(call).toBeDefined();
  expect(result).toBeDefined();
  expect((call?.payload as { tool: string }).tool).toBe("shell_command");
  expect((call?.payload as unknown as { args: { command: string } }).args.command).toBe("echo hi");
  expect(call?.semantic?.call_id).toBe("call-abc");
  expect((result?.payload as { ok: boolean }).ok).toBe(true);
  expect((result?.payload as { output: string }).output).toBe("hi\n");
  expect((result?.payload as { for_id?: string }).for_id).toBe(call?.id);
  expect(result?.semantic?.call_id).toBe("call-abc");
});

test("parseSession bundles a direct spawn_agent child session", async () => {
  const parentId = "019d9000-bbbb-7000-a000-000000000001";
  const childId = "019d9000-bbbb-7000-a000-000000000002";
  const childPath = seedSession({
    date: { y: "2026", m: "05", d: "30" },
    id: childId,
    cwd: process.cwd(),
    extraPayload: {
      thread_source: "subagent",
      source: { subagent: { thread_spawn: { parent_thread_id: parentId } } },
    },
    extraRecords: [
      {
        timestamp: "2026-05-30T01:47:00.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "child result",
        },
      },
    ],
  });
  const parentPath = seedSession({
    date: { y: "2026", m: "05", d: "30" },
    id: parentId,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-30T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn-1",
          name: "spawn_agent",
          arguments: JSON.stringify({
            agent_type: "reviewer",
            message: "inspect parser",
            reasoning_effort: "high",
          }),
        },
      },
      {
        timestamp: "2026-05-30T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: childId, nickname: "Reviewer" }),
        },
      },
    ],
  });

  const trail = await codexAdapter.parseSession({
    id: parentId,
    adapter: "codex",
    path: parentPath,
  });

  expect(childPath).toContain(childId);
  expect(trail.groups).toHaveLength(2);
  const parent = trail.groups[0]!;
  const child = trail.groups[1]!;
  const invoke = parent.entries.find(
    (entry) => entry.type === "tool_call" && entry.payload.tool === "subagent_invoke",
  );
  expect(invoke).toBeDefined();
  expect(invoke?.payload).toEqual({
    tool: "subagent_invoke",
    args: { task: "inspect parser", agent_type: "reviewer", session_id: childId },
  });
  expect(child.header.id).toBe(childId);
  expect(child.header.fork_from).toEqual({ session_id: parent.header.id, entry_id: invoke?.id });
  expect(child.entries.some((entry) => entry.type === "agent_message")).toBe(true);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(diagnostics.some((d) => d.code.startsWith("child_session_"))).toBe(false);
});

test("parseSession does not bundle a spawn_agent child without child-side provenance", async () => {
  const parentId = "019d9000-bbbb-7000-a000-000000000011";
  const childId = "019d9000-bbbb-7000-a000-000000000012";
  seedSession({
    date: { y: "2026", m: "05", d: "31" },
    id: childId,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-31T01:47:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "untrusted child" },
      },
    ],
  });
  const parentPath = seedSession({
    date: { y: "2026", m: "05", d: "31" },
    id: parentId,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-31T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn-1",
          name: "spawn_agent",
          arguments: JSON.stringify({ agent_type: "reviewer", message: "inspect parser" }),
        },
      },
      {
        timestamp: "2026-05-31T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: childId, nickname: "Reviewer" }),
        },
      },
    ],
  });

  const trail = await codexAdapter.parseSession({
    id: parentId,
    adapter: "codex",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
  const invoke = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_call" && entry.payload.tool === "subagent_invoke",
  );
  expect(invoke?.payload).toEqual({
    tool: "subagent_invoke",
    args: { task: "inspect parser", agent_type: "reviewer" },
  });
});

test("parseSession does not bundle a spawn_agent child when provenance only appears on a later event", async () => {
  const parentId = "019d9000-bbbb-7000-a000-000000000041";
  const childId = "019d9000-bbbb-7000-a000-000000000042";
  seedSession({
    date: { y: "2026", m: "05", d: "31" },
    id: childId,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-31T01:47:00.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "spoofed child provenance",
          thread_source: "subagent",
          source: { subagent: { thread_spawn: { parent_thread_id: parentId } } },
        },
      },
    ],
  });
  const parentPath = seedSession({
    date: { y: "2026", m: "05", d: "31" },
    id: parentId,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-31T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn-1",
          name: "spawn_agent",
          arguments: JSON.stringify({ agent_type: "reviewer", message: "inspect parser" }),
        },
      },
      {
        timestamp: "2026-05-31T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: childId, nickname: "Reviewer" }),
        },
      },
    ],
  });

  const trail = await codexAdapter.parseSession({
    id: parentId,
    adapter: "codex",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
  const invoke = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_call" && entry.payload.tool === "subagent_invoke",
  );
  expect(invoke?.payload).toEqual({
    tool: "subagent_invoke",
    args: { task: "inspect parser", agent_type: "reviewer" },
  });
});

test("parseSession does not scan ambient Codex sessions for arbitrary parent files", async () => {
  const parentId = "019d9000-bbbb-7000-a000-000000000051";
  const childId = "019d9000-bbbb-7000-a000-000000000052";
  seedSession({
    date: { y: "2026", m: "05", d: "31" },
    id: childId,
    cwd: process.cwd(),
    extraPayload: {
      thread_source: "subagent",
      source: { subagent: { thread_spawn: { parent_thread_id: parentId } } },
    },
    extraRecords: [
      {
        timestamp: "2026-05-31T01:47:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "ambient child result" },
      },
    ],
  });
  const parentPath = join(tmpCwd, "outside-parent.jsonl");
  writeFileSync(
    parentPath,
    `${[
      {
        timestamp: "2026-05-31T01:46:00.000Z",
        type: "session_meta",
        payload: {
          id: parentId,
          timestamp: "2026-05-31T01:46:00.000Z",
          cwd: process.cwd(),
          originator: "codex-tui",
          cli_version: "0.128.0",
        },
      },
      {
        timestamp: "2026-05-31T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn-1",
          name: "spawn_agent",
          arguments: JSON.stringify({ agent_type: "reviewer", message: "inspect parser" }),
        },
      },
      {
        timestamp: "2026-05-31T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: childId, nickname: "Reviewer" }),
        },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
  );

  const trail = await codexAdapter.parseSession({
    id: parentId,
    adapter: "codex",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
  const invoke = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_call" && entry.payload.tool === "subagent_invoke",
  );
  expect(invoke?.payload).toEqual({
    tool: "subagent_invoke",
    args: { task: "inspect parser", agent_type: "reviewer" },
  });
});

test("parseSession does not follow symlinked Codex session directories for children", async () => {
  const parentId = "019d9000-bbbb-7000-a000-000000000061";
  const childId = "019d9000-bbbb-7000-a000-000000000062";
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  mkdirSync(sessionsDir, { recursive: true });
  const outsideDir = mkdtempSync(join(tmpdir(), "codex-adapter-linked-child-"));
  const childPath = join(outsideDir, `rollout-2026-05-31T01-47-00-000Z-${childId}.jsonl`);
  writeFileSync(
    childPath,
    `${[
      {
        timestamp: "2026-05-31T01:47:00.000Z",
        type: "session_meta",
        payload: {
          id: childId,
          timestamp: "2026-05-31T01:47:00.000Z",
          cwd: process.cwd(),
          originator: "codex-tui",
          cli_version: "0.128.0",
          thread_source: "subagent",
          source: { subagent: { thread_spawn: { parent_thread_id: parentId } } },
        },
      },
      {
        timestamp: "2026-05-31T01:47:01.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "symlinked child result" },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
  );
  symlinkSync(outsideDir, join(sessionsDir, "linked-child-dir"), "dir");
  const parentPath = seedSession({
    date: { y: "2026", m: "05", d: "31" },
    id: parentId,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-31T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn-1",
          name: "spawn_agent",
          arguments: JSON.stringify({ agent_type: "reviewer", message: "inspect parser" }),
        },
      },
      {
        timestamp: "2026-05-31T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: childId, nickname: "Reviewer" }),
        },
      },
    ],
  });

  const trail = await codexAdapter.parseSession({
    id: parentId,
    adapter: "codex",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
  const invoke = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_call" && entry.payload.tool === "subagent_invoke",
  );
  expect(invoke?.payload).toEqual({
    tool: "subagent_invoke",
    args: { task: "inspect parser", agent_type: "reviewer" },
  });
  rmSync(outsideDir, { recursive: true, force: true });
});

test("parseSession skips incompatible Codex child files instead of failing parent parse", async () => {
  const parentId = "019d9000-bbbb-7000-a000-000000000031";
  const childId = "019d9000-bbbb-7000-a000-000000000032";
  const childPath = seedSession({
    date: { y: "2026", m: "06", d: "02" },
    id: childId,
    cwd: process.cwd(),
  });
  writeFileSync(
    childPath,
    `${JSON.stringify({
      type: "session_meta",
      payload: {
        id: childId,
        cwd: process.cwd(),
        originator: "codex-tui",
        cli_version: "0.128.0",
        thread_source: "subagent",
        source: { subagent: { thread_spawn: { parent_thread_id: parentId } } },
      },
    })}\n`,
  );
  const parentPath = seedSession({
    date: { y: "2026", m: "06", d: "02" },
    id: parentId,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-06-02T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn-1",
          name: "spawn_agent",
          arguments: JSON.stringify({ agent_type: "reviewer", message: "inspect parser" }),
        },
      },
      {
        timestamp: "2026-06-02T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: childId, nickname: "Reviewer" }),
        },
      },
    ],
  });

  const trail = await codexAdapter.parseSession({
    id: parentId,
    adapter: "codex",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession dedupes repeated spawn_agent outputs for the same child", async () => {
  const parentId = "019d9000-bbbb-7000-a000-000000000021";
  const childId = "019d9000-bbbb-7000-a000-000000000022";
  seedSession({
    date: { y: "2026", m: "06", d: "01" },
    id: childId,
    cwd: process.cwd(),
    extraPayload: {
      thread_source: "subagent",
      source: { subagent: { thread_spawn: { parent_thread_id: parentId } } },
    },
    extraRecords: [
      {
        timestamp: "2026-06-01T01:47:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "child result" },
      },
    ],
  });
  const parentPath = seedSession({
    date: { y: "2026", m: "06", d: "01" },
    id: parentId,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-06-01T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-spawn-1",
          name: "spawn_agent",
          arguments: JSON.stringify({ agent_type: "reviewer", message: "inspect parser" }),
        },
      },
      {
        timestamp: "2026-06-01T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: childId, nickname: "Reviewer" }),
        },
      },
      {
        timestamp: "2026-06-01T01:46:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-spawn-1",
          output: JSON.stringify({ agent_id: childId, nickname: "Reviewer" }),
        },
      },
    ],
  });

  const trail = await codexAdapter.parseSession({
    id: parentId,
    adapter: "codex",
    path: parentPath,
  });

  expect(trail.groups.map((group) => group.header.id)).toEqual([parentId, childId]);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("update_plan function calls emit task_plan_update and drop matching ack outputs", async () => {
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id: "019d8a00-1310-7000-a000-000000000131",
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-plan-1",
          name: "update_plan",
          arguments: JSON.stringify({
            explanation: "checking the plan",
            plan: [
              { step: "Write failing test", status: "pending" },
              { step: "Implement change", status: "pending" },
            ],
          }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-plan-1",
          output: "{}",
        },
      },
      {
        timestamp: "2026-05-28T01:46:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-plan-2",
          name: "update_plan",
          arguments: JSON.stringify({
            plan: [
              { step: "Check docs", status: "pending" },
              { step: "Write  failing\n test", status: "completed" },
              { step: "Implement change", status: "in_progress" },
            ],
          }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-plan-2",
          output: "{}",
        },
      },
      {
        timestamp: "2026-05-28T01:46:05.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-plan-3",
          name: "update_plan",
          arguments: JSON.stringify({
            plan: [
              { step: "Check docs", status: "completed" },
              { step: "Write failing test", status: "completed" },
            ],
          }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:06.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-plan-3",
          output: "{}",
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({
    id: "019d8a00-1310-7000-a000-000000000131",
    adapter: "codex",
    path,
  });

  const plans = trail.groups[0]!.entries.filter((entry) => entry.type === "task_plan_update");
  expect(plans).toHaveLength(3);
  expect(
    trail.groups[0]!.entries.some(
      (entry) =>
        entry.type === "tool_call" &&
        (entry.payload as { args?: { name?: unknown } }).args?.name === "update_plan",
    ),
  ).toBe(false);
  expect(trail.groups[0]!.entries.some((entry) => entry.type === "tool_result")).toBe(false);

  const firstPayload = plans[0]?.payload as {
    explanation?: string;
    items: Array<{ id: string; content: string; status: string }>;
    deltas: Array<Record<string, unknown>>;
  };
  const secondPayload = plans[1]?.payload as {
    items: Array<{ id: string; content: string; status: string }>;
    deltas: Array<Record<string, unknown>>;
  };
  const thirdPayload = plans[2]?.payload as {
    items: Array<{ id: string; content: string; status: string }>;
    deltas: Array<Record<string, unknown>>;
  };
  const firstItemId = firstPayload.items[0]?.id;
  const secondItemId = firstPayload.items[1]?.id;
  if (firstItemId === undefined || secondItemId === undefined) {
    throw new Error("expected two task plan item ids");
  }
  expect(firstPayload.explanation).toBe("checking the plan");
  expect(firstPayload.items).toEqual([
    { id: firstItemId, content: "Write failing test", status: "pending" },
    { id: secondItemId, content: "Implement change", status: "pending" },
  ]);
  expect(firstPayload.deltas.map((delta) => delta.kind)).toEqual(["added", "added"]);
  expect(secondPayload.items.slice(1).map((item) => item.id)).toEqual(
    firstPayload.items.map((item) => item.id),
  );
  const insertedItemId = secondPayload.items[0]?.id;
  if (insertedItemId === undefined) throw new Error("expected inserted task plan item id");
  expect(secondPayload.deltas[0]).toEqual({
    kind: "added",
    item_id: insertedItemId,
    to_content: "Check docs",
    to_status: "pending",
  });
  expect(secondPayload.deltas).toContainEqual({
    kind: "status_changed",
    item_id: firstItemId,
    from_status: "pending",
    to_status: "completed",
  });
  expect(secondPayload.deltas).toContainEqual({
    kind: "content_changed",
    item_id: firstItemId,
    from_content: "Write failing test",
    to_content: "Write  failing\n test",
  });
  expect(secondPayload.deltas).toContainEqual({
    kind: "status_changed",
    item_id: secondItemId,
    from_status: "pending",
    to_status: "in_progress",
  });
  expect(thirdPayload.items.map((item) => item.id)).toEqual([insertedItemId, firstItemId]);
  expect(thirdPayload.deltas).toContainEqual({
    kind: "status_changed",
    item_id: insertedItemId,
    from_status: "pending",
    to_status: "completed",
  });
  expect(thirdPayload.deltas).toContainEqual({
    kind: "content_changed",
    item_id: firstItemId,
    from_content: "Write  failing\n test",
    to_content: "Write failing test",
  });
  expect(thirdPayload.deltas).toContainEqual({
    kind: "removed",
    item_id: secondItemId,
    from_content: "Implement change",
    from_status: "in_progress",
  });

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("update_plan ack dropping keeps failed outputs and colliding non-plan tool results", async () => {
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id: "019d8a00-1311-7000-a000-000000000131",
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-plan-failed",
          name: "update_plan",
          arguments: JSON.stringify({ plan: [{ step: "Write test", status: "pending" }] }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-plan-failed",
          success: false,
          output: "plan update rejected",
        },
      },
      {
        timestamp: "2026-05-28T01:46:03.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-plan-note",
          name: "update_plan",
          arguments: JSON.stringify({ plan: [{ step: "Write test", status: "pending" }] }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:04.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-plan-note",
          output: "warning: plan was normalized",
        },
      },
      {
        timestamp: "2026-05-28T01:46:05.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-shared",
          name: "update_plan",
          arguments: JSON.stringify({ plan: [{ step: "Write test", status: "completed" }] }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:06.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-shared",
          name: "shell_command",
          arguments: JSON.stringify({ command: "printf real" }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:07.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-shared",
          output: "real output",
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({
    id: "019d8a00-1311-7000-a000-000000000131",
    adapter: "codex",
    path,
  });

  const results = trail.groups[0]!.entries.filter((entry) => entry.type === "tool_result");
  expect(results.map((entry) => (entry.payload as { output?: string }).output).sort()).toEqual([
    "plan update rejected",
    "real output",
    "warning: plan was normalized",
  ]);
  const failedPlanResult = results.find(
    (entry) => (entry.payload as { output?: string }).output === "plan update rejected",
  );
  expect((failedPlanResult?.payload as { ok?: boolean }).ok).toBe(false);
  expect((failedPlanResult?.payload as { for_id?: string }).for_id).toBeUndefined();
  const shellCall = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_call" && entry.semantic?.call_id === "call-shared",
  );
  const shellResult = results.find(
    (entry) => (entry.payload as { output?: string }).output === "real output",
  );
  expect((shellResult?.payload as { for_id?: string }).for_id).toBe(shellCall?.id);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession maps nested failed function output to a failed tool_result", async () => {
  const id = "019d8a00-1311-7000-a000-000000000132";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-nested-error",
          name: "shell_command",
          arguments: JSON.stringify({ command: "run failing tool" }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-nested-error",
          output: { body: "tool failed before producing a response", success: false },
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });

  const call = trail.groups[0]!.entries.find((entry) => entry.type === "tool_call");
  const result = trail.groups[0]!.entries.find((entry) => entry.type === "tool_result");
  expect(result?.payload).toEqual({
    for_id: call?.id,
    ok: false,
    output: "tool failed before producing a response",
    error: "tool failed before producing a response",
  });
  expect(result?.semantic).toEqual({
    call_id: "call-nested-error",
    tool_kind: "shell_command",
  });

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession sanitizes ill-formed strings before emitted records are validated", async () => {
  const id = "019d8a00-1311-7000-a000-00000000013a";
  const loneSurrogate = String.fromCharCode(0xdc00);
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-ill-formed-output",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "printf bad" }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-ill-formed-output",
          output: {
            body: `bad ${loneSurrogate}`,
            success: false,
          },
        },
      },
    ],
  });
  const codexHome = codexHomeDir();
  if (codexHome === undefined) throw new Error("expected codex home");
  writeFileSync(
    join(codexHome, "session_index.jsonl"),
    `${JSON.stringify({
      id,
      thread_name: `  source ${loneSurrogate} raw  `,
      updated_at: "2026-06-02T04:51:00.000000Z",
    })}\n`,
  );

  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const result = trail.groups[0]!.entries.find((entry) => entry.type === "tool_result");
  const update = trail.groups[0]!.entries.find(
    (entry) => entry.type === "session_metadata_update" && entry.payload?.field === "name",
  );

  expect((result?.payload as { output?: string; error?: string }).output).toBe("bad �");
  expect((result?.payload as { output?: string; error?: string }).error).toBe("bad �");
  expect((update?.payload as { value?: string }).value).toBe("source � raw");
  expect((update?.source?.raw as { thread_name?: string } | undefined)?.thread_name).toBe(
    "  source � raw  ",
  );
  expect(await validateAdapterTrail(trail)).toEqual([]);
});

test("parseSession keeps nonzero command output successful when tool metadata says success", async () => {
  const id = "019d8a00-1311-7000-a000-000000000133";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-nonzero-exit",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "false" }),
        },
      },
      {
        timestamp: "2026-05-28T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-nonzero-exit",
          output: {
            body: "Process exited with code 2\nOutput:\ncommand failed",
            success: true,
          },
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });

  const result = trail.groups[0]!.entries.find((entry) => entry.type === "tool_result");
  expect(result?.payload).toEqual({
    for_id: trail.groups[0]!.entries.find((entry) => entry.type === "tool_call")?.id,
    ok: true,
    output: "Process exited with code 2\nOutput:\ncommand failed",
  });
  expect(result?.semantic).toEqual({
    call_id: "call-nonzero-exit",
    tool_kind: "shell_command",
  });

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession maps nested custom tool output status and body", async () => {
  const id = "019d8a00-1311-7000-a000-000000000134";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call-custom-nested-error",
          name: "freeform_tool",
          input: "fail",
        },
      },
      {
        timestamp: "2026-05-28T01:46:02.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-custom-nested-error",
          output: { body: "custom tool failed", success: false },
        },
      },
      {
        timestamp: "2026-05-28T01:46:03.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          call_id: "call-custom-nested-ok",
          name: "freeform_tool",
          input: "succeed",
        },
      },
      {
        timestamp: "2026-05-28T01:46:04.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-custom-nested-ok",
          output: {
            body: "Exit code: 2\nOutput:\ncustom command chose nonzero",
            success: true,
          },
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });

  const failedCall = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_call" && entry.semantic?.call_id === "call-custom-nested-error",
  );
  const failedResult = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "tool_result" && entry.semantic?.call_id === "call-custom-nested-error",
  );
  expect(failedResult?.payload).toEqual({
    for_id: failedCall?.id,
    ok: false,
    output: "custom tool failed",
    error: "custom tool failed",
  });

  const okCall = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_call" && entry.semantic?.call_id === "call-custom-nested-ok",
  );
  const okResult = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_result" && entry.semantic?.call_id === "call-custom-nested-ok",
  );
  expect(okResult?.payload).toEqual({
    for_id: okCall?.id,
    ok: true,
    output: "Exit code: 2\nOutput:\ncustom command chose nonzero",
  });

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("exec_command function_call maps to shell_command with workdir as cwd", async () => {
  const trail = await parseDesktopFixture();
  const exec = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-exec-1",
  );
  expect(exec).toBeDefined();
  expect((exec?.payload as { tool: string }).tool).toBe("shell_command");
  const args = (exec?.payload as { args: { command: string; cwd?: string } }).args;
  expect(args.command).toBe("ls -la");
  expect(args.cwd).toBe("/proj/codex-fixture");
});

test("mapTool promotes common Codex function calls out of other", () => {
  expect(mapTool("shell_command", { command: "pwd", cwd: "/repo" })).toEqual({
    tool: "shell_command",
    args: { command: "pwd", cwd: "/repo" },
  });
  expect(mapTool("write_stdin", { chars: "yes\n", session_id: 42 })).toEqual({
    tool: "shell_input",
    args: { input: "yes\n", session_id: "42" },
  });
  expect(mapTool("write_stdin", { chars: "yes\n", command_id: "cmd-1" })).toEqual({
    tool: "shell_input",
    args: { input: "yes\n", command_id: "cmd-1" },
  });
  expect(mapTool("write_stdin", { chars: "yes\n", command_id: "cmd-1", session_id: 42 })).toEqual({
    tool: "shell_input",
    args: { input: "yes\n", command_id: "cmd-1", session_id: "42" },
  });
  expect(
    mapTool("write_stdin", {
      chars: "yes\n",
      command_id: "01hevta0000000000000000001",
      session_id: "00000000-0000-5000-8000-ABCDEFABCDEF",
    }),
  ).toEqual({
    tool: "shell_input",
    args: {
      input: "yes\n",
      command_id: "01hevta0000000000000000001",
      session_id: "00000000-0000-5000-8000-ABCDEFABCDEF",
    },
  });
  expect(mapTool("write_stdin", { chars: "", session_id: 42 })).toEqual({
    tool: "shell_output",
    args: { command_id: "42" },
  });
  expect(mapTool("write_stdin", { chars: "", command_id: "cmd-1", session_id: 42 })).toEqual({
    tool: "shell_output",
    args: { command_id: "cmd-1" },
  });
  expect(mapTool("mcp__computer_use__click", { x: 10 })).toEqual({
    tool: "mcp_call",
    args: { server: "computer_use", tool: "click", args: { x: 10 } },
  });
  expect(
    mapTool("mcp__computer_use__click", {
      headers: { Authorization: "Bearer abcdefABCDEF0123456789xyzXYZ" },
      x: 10,
    }),
  ).toEqual({
    tool: "mcp_call",
    args: {
      server: "computer_use",
      tool: "click",
      args: { x: 10 },
      headers: { Authorization: "[REDACTED_HEADER]" },
    },
  });
  expect(mapTool("mcp__demo__lookup", { name: "alice", tool: "hammer", other: 1 })).toEqual({
    tool: "mcp_call",
    args: { server: "demo", tool: "lookup", args: { name: "alice", tool: "hammer", other: 1 } },
  });
  expect(mapTool("connector", { namespace: "mcp__computer_use", name: "click", x: 10 })).toEqual({
    tool: "mcp_call",
    args: { server: "computer_use", tool: "click", args: { x: 10 } },
  });
  expect(
    mapTool("connector", {
      namespace: "mcp__computer_use",
      name: "click",
      headers: {
        Authorization: "Bearer abcdefABCDEF0123456789xyzXYZ",
        Cookie: "sid=opaque",
        "X-Session-Token": "opaque",
      },
      x: 10,
    }),
  ).toEqual({
    tool: "mcp_call",
    args: {
      server: "computer_use",
      tool: "click",
      args: { x: 10 },
      headers: {
        Authorization: "[REDACTED_HEADER]",
        Cookie: "[REDACTED_HEADER]",
        "X-Session-Token": "[REDACTED_HEADER]",
      },
    },
  });
  expect(mapTool("mcp__demo__lookup", { headers: "Cookie: sid=opaque", x: 10 })).toEqual({
    tool: "mcp_call",
    args: { server: "demo", tool: "lookup", args: { x: 10 } },
  });
  expect(mapTool("tool_search", { q: "auth flow", top_k: 3 })).toEqual({
    tool: "tool_search",
    args: { query: "auth flow", limit: 3 },
  });
});

test("compact fixture emits context_compact from top-level compacted record", async () => {
  const trail = await parseCompactFixture();
  const compact = trail.groups[0]!.entries.find((e) => e.type === "context_compact");
  expect(compact).toBeDefined();
  expect((compact?.payload as { summary: string }).summary).toBe(
    "Refactored auth module. Tests pass.",
  );
  expect((compact?.payload as { trigger?: string }).trigger).toBe("auto");
  // Real Codex `compacted` records do not carry token counts; the schema
  // optional fields stay absent.
  expect((compact?.payload as { tokens_before?: number }).tokens_before).toBeUndefined();
  expect((compact?.payload as { tokens_after?: number }).tokens_after).toBeUndefined();
  expect(
    (compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids,
  ).toBeUndefined();
  expect(
    (compact?.source?.raw as { payload?: { replacement_history?: unknown } } | undefined)?.payload
      ?.replacement_history,
  ).toMatchObject({ elided: true, item_count: 2 });
  expect(
    typeof (
      compact?.source?.raw as { payload?: { replacement_history?: { size_bytes?: unknown } } }
    )?.payload?.replacement_history?.size_bytes,
  ).toBe("number");
  expect(JSON.stringify(compact?.source?.raw)).not.toContain("first turn");
  expect(JSON.stringify(compact?.source?.raw)).not.toContain("first response");
  expect(compact?.meta?.["dev.codex.raw_type"]).toBe("compacted");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("parseSession() emits context_compact for empty-message compacted records", async () => {
  const id = "019d8a00-1760-7000-a000-000000000176";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T03:00:04.000Z",
        type: "compacted",
        payload: {
          message: "",
          replacement_history: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "folded prompt" }],
            },
          ],
        },
      },
      {
        timestamp: "2026-05-28T03:00:05.000Z",
        type: "turn_context",
        payload: {
          cwd: process.cwd(),
          model: "gpt-5-codex",
          turn_id: "turn-after-compact",
          summary: "auto",
        },
      },
    ],
  });

  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const compact = trail.groups[0]!.entries.find((e) => e.type === "context_compact");
  expect(compact).toBeDefined();
  expect((compact?.payload as { summary?: string }).summary).toBe("");
  expect(
    (compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids,
  ).toBeUndefined();
  expect(
    (compact?.source?.raw as { payload?: { replacement_history?: unknown } } | undefined)?.payload
      ?.replacement_history,
  ).toMatchObject({ elided: true, item_count: 1 });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("source raw policy elides oversized codex raw arguments", async () => {
  const id = "019d8a00-1760-7000-a000-000000000176";
  const hugeArguments = `not-json-${"x".repeat(40_000)}`;
  const previousHardCap = process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP;
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T01:46:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-huge-raw",
          name: "unknown_tool",
          arguments: hugeArguments,
        },
      },
    ],
  });

  process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP = "32768";
  try {
    const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
    const call = trail.groups[0]!.entries.find((entry) => entry.type === "tool_call");
    expect((call?.source?.raw as { arguments?: unknown } | undefined)?.arguments).toEqual({
      elided: true,
      size_bytes: hugeArguments.length,
    });
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    if (previousHardCap === undefined) {
      delete process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP;
    } else {
      process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP = previousHardCap;
    }
  }
});

test("compact fixture emits synthesized model_change at the in-session model switch", async () => {
  const trail = await parseCompactFixture();
  const modelChanges = trail.groups[0]!.entries.filter((e) => e.type === "model_change");
  expect(modelChanges).toHaveLength(2);
  expect(modelChanges[0]?.payload).toMatchObject({
    to_model: "gpt-5-codex",
    trigger: "initial",
  });
  const mc = modelChanges[1];
  expect(mc?.payload).toMatchObject({
    from_model: "gpt-5-codex",
    to_model: "gpt-5-codex-mini",
    trigger: "runtime_inferred",
  });
  expect(mc?.source?.synthesized).toBe(true);
  expect(mc?.meta?.["dev.codex.raw_type"]).toBe("turn_context.model_change");
});

test("reasoning fixture emits one agent_thinking per turn with dev.codex.raw_type audit tag", async () => {
  const trail = await parseReasoningFixture();
  const thinking = trail.groups[0]!.entries.filter((e) => e.type === "agent_thinking");
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

test("parseSession throws when no parseable object header exists", async () => {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  const dayDir = join(sessionsDir, "2026", "05", "28");
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, "rollout-non-object-header.jsonl");
  writeFileSync(path, "[]\n42\nnot json\n");
  await expect(
    codexAdapter.parseSession({ id: "malformed", adapter: "codex", path }),
  ).rejects.toThrow(/parseable JSON object header/);
});

test("parseSession stamps timestamp-less drift quarantine from the session header", async () => {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  const dayDir = join(sessionsDir, "2026", "05", "28");
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, "rollout-timestamp-less-drift-019d.jsonl");
  const ts = "2026-05-28T01:00:00.000Z";
  writeFileSync(
    path,
    `${JSON.stringify({
      timestamp: ts,
      type: "session_meta",
      payload: {
        id: "019d7909-85dd-7881-aa12-95ffc8ca8bb2",
        timestamp: ts,
        cwd: process.cwd(),
        cli_version: "0.128.0",
      },
    })}\n${JSON.stringify({ type: "totally_unknown_codex_record", payload: { opaque: true } })}\n`,
  );

  const trail = await codexAdapter.parseSession({
    id: "019d7909-85dd-7881-aa12-95ffc8ca8bb2",
    adapter: "codex",
    path,
  });
  const quarantine = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind?: string }).kind === "x-codex/unknown_record",
  );
  expect(quarantine?.ts).toBe(ts);
  expect(trail.groups[0]!.header.parse_fidelity).toEqual({ quarantined_count: 1 });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("CODEX_HOME whitespace-only override falls back to default", () => {
  process.env.CODEX_HOME = "   ";
  expect(codexHomeDir()).toBe(join(tmpHome, ".codex"));
});

test("parseSession produces deterministic entry ids across re-parses (spec §8.5)", async () => {
  const a = await parseDesktopFixture();
  const b = await parseDesktopFixture();
  expect(a.groups[0]!.header.session_uid).toBe(b.groups[0]!.header.session_uid);
  const idsA = a.groups[0]!.entries.map((e) => e.id);
  const idsB = b.groups[0]!.entries.map((e) => e.id);
  expect(idsA).toEqual(idsB);
  // for_id linkage should also be stable.
  const aResult = a.groups[0]!.entries.find((e) => e.type === "tool_result");
  const bResult = b.groups[0]!.entries.find((e) => e.type === "tool_result");
  expect((aResult?.payload as { for_id?: string }).for_id).toBe(
    (bResult?.payload as { for_id?: string }).for_id,
  );
});

test("event_msg.task_started emits system_event with reserved kind task_started", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
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

test("event_msg.item_started emits vendor item marker without inventing plan state", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" &&
      e.source?.original_type === "event_msg.item_started" &&
      (e.payload as { kind?: string }).kind === "x-codex/item_started",
  );
  expect(evt).toBeDefined();
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;
  expect(data).toEqual({
    thread_id: "thread-1",
    turn_id: "turn-life",
    started_at_ms: 1748430002250,
    item: {
      type: "Plan",
      id: "plan-life",
      steps: [{ step: "do the thing", status: "in_progress" }],
    },
  });
  expect(evt?.meta?.["dev.codex.raw_type"]).toBe("event_msg.item_started");
});

test("event_msg.task_complete emits system_event with canonical task_completed kind", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
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

test("event_msg hook_started and hook_completed emit hook_fired with run data", async () => {
  const trail = await parseLifecycleFixture();
  const byRawType = (rawType: string) =>
    trail.groups[0]!.entries.find(
      (e) =>
        e.type === "system_event" &&
        e.source?.original_type === rawType &&
        (e.payload as { kind?: string }).kind === "hook_fired",
    );
  const started = byRawType("event_msg.hook_started");
  const completed = byRawType("event_msg.hook_completed");

  expect(started).toBeDefined();
  expect((started?.payload as { data?: Record<string, unknown> }).data).toEqual({
    turn_id: "turn-life",
    run: {
      id: "hook-run-1",
      event_name: "PreToolUse",
      handler_type: "command",
      execution_mode: "blocking",
      scope: "project",
      source_path: "/proj/codex-lifecycle/.codex/hooks/pre.sh",
      source: "config",
      display_order: 1,
      status: "running",
      status_message: "running hook",
      started_at: 1748430002500,
      entries: [],
    },
  });

  expect(completed).toBeDefined();
  expect((completed?.payload as { data?: Record<string, unknown> }).data).toEqual({
    turn_id: "turn-life",
    run: {
      id: "hook-run-1",
      event_name: "PreToolUse",
      handler_type: "command",
      execution_mode: "blocking",
      scope: "project",
      source_path: "/proj/codex-lifecycle/.codex/hooks/pre.sh",
      source: "config",
      display_order: 1,
      status: "completed",
      status_message: "hook ok",
      started_at: 1748430002500,
      completed_at: 1748430002750,
      duration_ms: 250,
      entries: [{ stream: "stdout", text: "ok" }],
    },
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg hook lifecycle truncates run entry text", async () => {
  const path = join(tmpCwd, "codex-hook-output.jsonl");
  const largeText = "x".repeat(3000);
  const records = [
    {
      timestamp: "2026-05-28T11:00:02.000Z",
      type: "session_meta",
      payload: {
        id: "00000000-0000-0000-0000-0000000000ac",
        timestamp: "2026-05-28T11:00:02.000Z",
        cwd: tmpCwd,
        originator: "codex-tui",
        cli_version: "0.135.0",
        source: "interactive",
        model_provider: "openai",
      },
    },
    {
      timestamp: "2026-05-28T11:00:02.750Z",
      type: "event_msg",
      payload: {
        type: "hook_completed",
        turn_id: "turn-life",
        run: {
          id: "hook-run-1",
          event_name: "PreToolUse",
          status: "completed",
          entries: [{ stream: "stdout", text: largeText, ignored: "not-curated" }],
        },
      },
    },
  ];
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  const trail = await codexAdapter.parseSession({
    id: "00000000-0000-0000-0000-0000000000ac",
    adapter: "codex",
    path,
  });
  const evt = trail.groups[0]!.entries.find(
    (e) => e.type === "system_event" && e.source?.original_type === "event_msg.hook_completed",
  );
  const data = (evt?.payload as { data?: { run?: { entries?: Record<string, unknown>[] } } }).data;
  const entry = data?.run?.entries?.[0];

  expect(entry?.stream).toBe("stdout");
  expect((entry?.text as string).length).toBeLessThan(largeText.length);
  expect(entry?.ignored).toBeUndefined();
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.exec_command_end emits x-codex/exec_command_end linked by call_id", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
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

test("event_msg.exec_command_begin emits x-codex/exec_command_begin linked by call_id", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind: string }).kind === "x-codex/exec_command_begin",
  );
  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-exec-life");
  expect(evt?.source?.original_type).toBe("event_msg.exec_command_begin");
  expect(evt?.meta?.["dev.codex.raw_type"]).toBe("event_msg.exec_command_begin");
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;
  expect(data).toEqual({
    call_id: "call-exec-life",
    turn_id: "turn-life",
    process_id: "proc-exec-life",
    started_at_ms: 1748430003500,
    command: ["ls"],
    cwd: "/proj/codex-lifecycle",
    parsed_cmd: [{ type: "ls", cmd: "ls" }],
    source: "agent",
    has_interaction_input: true,
    interaction_input_chars: 15,
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.exec_approval_request emits permission_request linked by call_id", async () => {
  const id = "019d8900-cccc-7000-e000-00000000000c";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    cliVersion: "0.135.0",
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "exec_approval_request",
          call_id: "call-exec-approval",
          approval_id: "approval-exec-1",
          turn_id: "turn-approval",
          started_at_ms: 1748430001000,
          command: ["bash", "-lc", "npm test"],
          cwd: "/proj/codex-approval",
          reason: "requires network",
          available_decisions: ["approved", "abort"],
          parsed_cmd: [{ type: "npm", cmd: "npm test" }],
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-exec-approval");
  expect(evt?.source?.original_type).toBe("event_msg.exec_approval_request");
  expect(evt?.meta?.["dev.codex.raw_type"]).toBe("event_msg.exec_approval_request");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    tool_call_id: "call-exec-approval",
    approval_id: "approval-exec-1",
    turn_id: "turn-approval",
    started_at_ms: 1748430001000,
    reason: "requires network",
    command: ["bash", "-lc", "npm test"],
    cwd: "/proj/codex-approval",
    available_decisions: ["approved", "abort"],
    parsed_cmd: [{ type: "npm", cmd: "npm test" }],
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.exec_approval_request preserves derived approval context without explicit decisions", async () => {
  const id = "019d8900-cccd-7000-e000-00000000000c";
  const networkApprovalContext = { host: "api.example.com", protocol: "https" };
  const proposedNetworkPolicyAmendments = [{ host: "api.example.com", action: "allow" }];
  const additionalPermissions = {
    file_system: { writable_roots: ["/proj/codex-approval"] },
  };
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    cliVersion: "0.135.0",
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "exec_approval_request",
          call_id: "call-exec-approval-context",
          turn_id: "turn-approval",
          started_at_ms: 1748430001000,
          command: ["bun", "test"],
          cwd: "/proj/codex-approval",
          network_approval_context: networkApprovalContext,
          proposed_execpolicy_amendment: ["bun", "test"],
          proposed_network_policy_amendments: proposedNetworkPolicyAmendments,
          additional_permissions: additionalPermissions,
          parsed_cmd: [{ type: "bun", cmd: "bun test" }],
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-exec-approval-context");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    tool_call_id: "call-exec-approval-context",
    turn_id: "turn-approval",
    started_at_ms: 1748430001000,
    command: ["bun", "test"],
    cwd: "/proj/codex-approval",
    network_approval_context: networkApprovalContext,
    proposed_execpolicy_amendment: ["bun", "test"],
    proposed_network_policy_amendments: proposedNetworkPolicyAmendments,
    additional_permissions: additionalPermissions,
    parsed_cmd: [{ type: "bun", cmd: "bun test" }],
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.request_permissions emits permission_request with requested permissions", async () => {
  const id = "019d8900-dddd-7000-e000-00000000000d";
  const permissions = {
    network: { mode: "enabled" },
    file_system: { writable_roots: ["/proj/codex-approval"] },
  };
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    cliVersion: "0.135.0",
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "request_permissions",
          call_id: "call-request-permissions",
          turn_id: "turn-approval",
          started_at_ms: 1748430001000,
          reason: "needs workspace write",
          permissions,
          cwd: "/proj/codex-approval",
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-request-permissions");
  expect(evt?.source?.original_type).toBe("event_msg.request_permissions");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    tool_call_id: "call-request-permissions",
    turn_id: "turn-approval",
    started_at_ms: 1748430001000,
    reason: "needs workspace write",
    permissions,
    cwd: "/proj/codex-approval",
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.request_permissions treats blank call_id as missing", async () => {
  const id = "019d8900-ddde-7000-e000-00000000000d";
  const permissions = { network: { mode: "enabled" } };
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    cliVersion: "0.135.0",
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "request_permissions",
          call_id: "   ",
          reason: "needs network",
          permissions,
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt?.semantic?.call_id).toBeUndefined();
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    reason: "needs network",
    permissions,
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.patch_apply_end emits x-codex/patch_apply_end linked by call_id", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
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

test("event_msg patch apply begin and update emit linked vendor lifecycle markers", async () => {
  const trail = await parseLifecycleFixture();
  const byKind = (kind: string) =>
    trail.groups[0]!.entries.find(
      (e) => e.type === "system_event" && (e.payload as { kind?: string }).kind === kind,
    );
  const begin = byKind("x-codex/patch_apply_begin");
  const updated = byKind("x-codex/patch_apply_updated");

  expect(begin).toBeDefined();
  expect(begin?.semantic?.call_id).toBe("call-patch-life");
  expect(begin?.source?.original_type).toBe("event_msg.patch_apply_begin");
  expect((begin?.payload as { data?: Record<string, unknown> }).data).toEqual({
    call_id: "call-patch-life",
    turn_id: "turn-life",
    auto_approved: true,
    changes: { "src/x.ts": { type: "modify" } },
  });

  expect(updated).toBeDefined();
  expect(updated?.semantic?.call_id).toBe("call-patch-life");
  expect(updated?.source?.original_type).toBe("event_msg.patch_apply_updated");
  expect((updated?.payload as { data?: Record<string, unknown> }).data).toEqual({
    call_id: "call-patch-life",
    turn_id: "turn-life",
    auto_approved: true,
    changes: { "src/x.ts": { type: "modify" } },
  });
});

test("event_msg.apply_patch_approval_request emits permission_request linked by call_id", async () => {
  const id = "019d8900-eeee-7000-e000-00000000000e";
  const changes = { "/private/tmp/outside.txt": { type: "add" } };
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    cliVersion: "0.135.0",
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "apply_patch_approval_request",
          call_id: "call-patch-approval",
          turn_id: "turn-approval",
          started_at_ms: 1748430001000,
          changes,
          reason: "writes outside workspace",
          grant_root: "/private/tmp",
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-patch-approval");
  expect(evt?.source?.original_type).toBe("event_msg.apply_patch_approval_request");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    tool_call_id: "call-patch-approval",
    turn_id: "turn-approval",
    started_at_ms: 1748430001000,
    changes,
    reason: "writes outside workspace",
    grant_root: "/private/tmp",
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.elicitation_request emits permission_request with request metadata", async () => {
  const id = "019d8900-ffff-7000-e000-00000000000f";
  const request = {
    message: "Linear needs a workspace choice",
    schema: {
      type: "object",
      required: ["workspace"],
      properties: {
        workspace: {
          type: "string",
          description: "Workspace slug",
          default: "private-workspace",
        },
      },
    },
  };
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    cliVersion: "0.135.0",
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "elicitation_request",
          id: "elicit-1",
          server_name: "linear",
          prompt: "Choose a Linear workspace",
          request,
          available_decisions: ["approve", "deny"],
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBeUndefined();
  expect(evt?.source?.original_type).toBe("event_msg.elicitation_request");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    request_id: "elicit-1",
    server_name: "linear",
    prompt: "Choose a Linear workspace",
    request: {
      schema: {
        type: "object",
        required: ["workspace"],
        properties: {
          workspace: {
            type: "string",
          },
        },
      },
    },
    available_decisions: ["approve", "deny"],
  });
  expect(JSON.stringify(evt?.payload)).not.toContain("private-workspace");
  expect(JSON.stringify(evt?.payload)).not.toContain("Workspace slug");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.elicitation_request sanitizes URL-mode request data", async () => {
  const id = "019d8901-0000-7000-e000-000000000010";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    cliVersion: "0.135.0",
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "elicitation_request",
          id: "elicit-url-1",
          server_name: "github",
          prompt: "Sign in to GitHub",
          request: {
            mode: "url",
            url: "https://auth.example.com/oauth/device?state=secret-state&token=secret-token#secret-fragment",
            elicitationId: "oauth-flow-1",
            title: "Authorize GitHub",
            description: "Complete account linking",
          },
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "permission_request",
  );

  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    request_id: "elicit-url-1",
    server_name: "github",
    prompt: "Sign in to GitHub",
    request: {
      mode: "url",
      elicitation_id: "oauth-flow-1",
      url_origin: "https://auth.example.com",
      url_host: "auth.example.com",
    },
  });
  const payloadJson = JSON.stringify(evt?.payload);
  expect(payloadJson).not.toContain("secret-state");
  expect(payloadJson).not.toContain("secret-token");
  expect(payloadJson).not.toContain("secret-fragment");
  expect(payloadJson).not.toContain("Authorize GitHub");
  expect(payloadJson).not.toContain("Complete account linking");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.elicitation_request strips form defaults and submitted values", async () => {
  const id = "019d8901-0001-7000-e000-000000000011";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    cliVersion: "0.135.0",
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "elicitation_request",
          id: "elicit-form-1",
          server_name: "deploy",
          prompt: "Provide deployment credentials",
          request: {
            mode: "form",
            requestedSchema: {
              type: "object",
              required: ["apiKey"],
              properties: {
                apiKey: {
                  type: "string",
                  title: "API key",
                  format: "password",
                  minLength: 8,
                  maxLength: 64,
                  pattern: "^[A-Za-z0-9-]+$",
                  enum: ["sk-live-secret"],
                  default: "sk-live-secret",
                  examples: ["sk-example-secret"],
                },
                region: {
                  type: "string",
                  default: "us-east-1",
                },
                replicas: {
                  type: "number",
                  minimum: 1,
                  maximum: 5,
                  multipleOf: 1,
                  exclusiveMaximum: false,
                },
              },
            },
            content: { apiKey: "sk-live-secret" },
          },
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "permission_request",
  );

  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    request_id: "elicit-form-1",
    server_name: "deploy",
    prompt: "Provide deployment credentials",
    request: {
      mode: "form",
      schema: {
        type: "object",
        required: ["apiKey"],
        properties: {
          apiKey: {
            type: "string",
            format: "password",
            pattern: "^[A-Za-z0-9-]+$",
            minLength: 8,
            maxLength: 64,
          },
          region: { type: "string" },
          replicas: {
            type: "number",
            minimum: 1,
            maximum: 5,
            multipleOf: 1,
            exclusiveMaximum: false,
          },
        },
      },
    },
  });
  const payloadJson = JSON.stringify(evt?.payload);
  expect(payloadJson).not.toContain("sk-live-secret");
  expect(payloadJson).not.toContain("sk-example-secret");
  expect(payloadJson).not.toContain("us-east-1");
  expect(payloadJson).not.toContain("API key");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("event_msg.mcp_tool_call_end emits x-codex/mcp_tool_call_end linked by call_id", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
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

test("event_msg.mcp_tool_call_begin emits x-codex/mcp_tool_call_begin linked by call_id", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind: string }).kind === "x-codex/mcp_tool_call_begin",
  );
  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("call-mcp-life");
  expect(evt?.source?.original_type).toBe("event_msg.mcp_tool_call_begin");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    call_id: "call-mcp-life",
    invocation: { server: "openai-bundled", tool: "computer.click" },
    plugin_id: "computer-use@openai-bundled",
    mcp_app_resource_uri: "app://computer-use",
  });
});

test("event_msg.thread_goal_updated emits session_metadata_update description", async () => {
  const trail = await parseLifecycleFixture();
  const evt = trail.groups[0]!.entries.find(
    (e) => e.type === "session_metadata_update" && e.payload?.field === "description",
  );
  expect(evt).toBeDefined();
  expect(trail.groups[0]!.header.description).toBe("finish the task");
  expect(evt?.payload).toEqual({
    field: "description",
    value: "finish the task",
    reason: "ai_generated",
  });
  expect(
    trail.groups[0]!.entries.some(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: unknown }).kind === "x-codex/thread_goal_updated",
    ),
  ).toBe(false);
});

test("event_msg.thread_goal_updated emits vendor session_metadata_update when summary is empty", async () => {
  const id = "019d8900-bbbb-7000-e000-00000000000b";
  const path = seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    extraRecords: [
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "thread_goal_updated",
          goal: { summary: "", items: ["finish"] },
        },
      },
    ],
  });
  const trail = await codexAdapter.parseSession({ id, adapter: "codex", path });
  const evt = trail.groups[0]!.entries.find(
    (e) => e.type === "session_metadata_update" && e.payload?.field === "x-codex/thread_goal",
  );

  expect(evt?.payload).toEqual({
    field: "x-codex/thread_goal",
    value: { summary: "", items: ["finish"] },
    reason: "ai_generated",
  });
  expect(
    trail.groups[0]!.entries.some(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: unknown }).kind === "x-codex/thread_goal_updated",
    ),
  ).toBe(false);
});

test("web_search_end emits x-codex/web_search_end system_event with query-based pairing", async () => {
  const trail = await parseWebSearchFixture();
  const evt = trail.groups[0]!.entries.find((e) => e.type === "system_event");
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
  const call = trail.groups[0]!.entries.find((e) => e.type === "tool_call");
  expect((call?.payload as unknown as { args: { query: string } }).args.query).toBe(
    "site:example.com api docs",
  );
  expect(evt?.meta?.["dev.codex.raw_type"]).toBe("event_msg.web_search_end");
});

test("web and image generation begin/end events emit vendor lifecycle markers", async () => {
  const trail = await parseLifecycleFixture();
  const byKind = (kind: string) =>
    trail.groups[0]!.entries.find(
      (e) => e.type === "system_event" && (e.payload as { kind?: string }).kind === kind,
    );
  const webBegin = byKind("x-codex/web_search_begin");
  const imageBegin = byKind("x-codex/image_generation_begin");
  const imageEnd = byKind("x-codex/image_generation_end");

  expect(webBegin?.semantic?.call_id).toBeUndefined();
  expect(webBegin?.source?.original_type).toBe("event_msg.web_search_begin");
  expect((webBegin?.payload as { data?: Record<string, unknown> }).data).toEqual({
    call_id: "ws-life",
  });

  expect(imageBegin?.semantic?.call_id).toBeUndefined();
  expect(imageBegin?.source?.original_type).toBe("event_msg.image_generation_begin");
  expect((imageBegin?.payload as { data?: Record<string, unknown> }).data).toEqual({
    call_id: "img-life",
  });

  expect(imageEnd?.semantic?.call_id).toBeUndefined();
  expect(imageEnd?.source?.original_type).toBe("event_msg.image_generation_end");
  expect((imageEnd?.payload as { data?: Record<string, unknown> }).data).toEqual({
    call_id: "img-life",
    status: "completed",
    revised_prompt: "draw lifecycle",
    result: "created",
    saved_path: "/proj/codex-lifecycle/out.png",
  });
});

test("web_search_call with action.type='search' maps to tool_call{tool:'web_search'}", async () => {
  const trail = await parseWebSearchFixture();
  const call = trail.groups[0]!.entries.find((e) => e.type === "tool_call");
  expect(call).toBeDefined();
  expect((call?.payload as { tool: string }).tool).toBe("web_search");
  expect((call?.payload as unknown as { args: { query: string } }).args.query).toBe(
    "site:example.com api docs",
  );
  expect(call?.meta?.["dev.codex.raw_type"]).toBe("response_item.web_search_call");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("response_item tool_search_call and open_page map to canonical tool kinds", async () => {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  const dayDir = join(sessionsDir, "2026", "05", "28");
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, "rollout-common-tools.jsonl");
  const lines = [
    {
      timestamp: "2026-05-28T11:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8a00-bbbb-7000-f000-00000000000b",
        timestamp: "2026-05-28T11:00:00.000Z",
        cwd: process.cwd(),
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T11:00:01.000Z",
      type: "response_item",
      payload: {
        type: "tool_search_call",
        call_id: "call-tool-search",
        arguments: '{"q":"auth flow","top_k":3}',
      },
    },
    {
      timestamp: "2026-05-28T11:00:02.000Z",
      type: "response_item",
      payload: {
        type: "web_search_call",
        action: { type: "open_page", url: "https://example.com/docs" },
      },
    },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const trail = await codexAdapter.parseSession({
    id: "019d8a00-bbbb-7000-f000-00000000000b",
    adapter: "codex",
    path,
  });

  const toolSearch = trail.groups[0]!.entries.find(
    (e) => e.semantic?.call_id === "call-tool-search",
  );
  expect(toolSearch?.payload).toEqual({
    tool: "tool_search",
    args: { query: "auth flow", limit: 3 },
  });
  const webFetch = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && (e.payload as { tool?: string }).tool === "web_fetch",
  );
  expect(webFetch?.payload).toEqual({
    tool: "web_fetch",
    args: { url: "https://example.com/docs" },
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("request_user_input emits structured user query and response events", async () => {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  const dayDir = join(sessionsDir, "2026", "05", "28");
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, "rollout-user-input-answer.jsonl");
  const lines = [
    {
      timestamp: "2026-05-28T12:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8b00-cccc-7000-a000-00000000000c",
        timestamp: "2026-05-28T12:00:00.000Z",
        cwd: process.cwd(),
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T12:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "request_user_input",
        call_id: "call-user-input",
        arguments: JSON.stringify({
          questions: [
            {
              id: "ship",
              header: "Ship",
              question: "Ship it?",
              is_secret: false,
              allowOther: true,
              options: [
                { id: "yes-safe", label: "yes", description: "Ship now" },
                { id: "", label: "later", description: "Ship later" },
                { id: "no", label: "no", description: "Hold" },
              ],
            },
          ],
        }),
      },
    },
    {
      timestamp: "2026-05-28T12:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-user-input",
        output:
          '{"answers":{"ship":{"answers":["yes","later","custom"],"other":"with changelog"},"unknown":{"answers":["drop me"]}}}',
      },
    },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const trail = await codexAdapter.parseSession({
    id: "019d8b00-cccc-7000-a000-00000000000c",
    adapter: "codex",
    path,
  });
  const query = trail.groups[0]!.entries.find(
    (e) => e.type === "user_query" && e.semantic?.call_id === "call-user-input",
  );
  const response = trail.groups[0]!.entries.find(
    (e) => e.type === "user_query_response" && e.semantic?.call_id === "call-user-input",
  );

  expect(query?.payload).toEqual({
    questions: [
      {
        id: "ship",
        header: "Ship",
        question: "Ship it?",
        is_secret: false,
        allow_other: true,
        options: [
          { id: "yes-safe", label: "yes", description: "Ship now" },
          { label: "later", description: "Ship later" },
          { id: "no", label: "no", description: "Hold" },
        ],
      },
    ],
  });
  expect(response?.payload).toEqual({
    for_id: query?.id,
    answers: { ship: { selected: ["yes-safe", "later"], other: "with changelog, custom" } },
  });
  expect(
    trail.groups[0]!.entries.some(
      (e) => e.type === "tool_call" && e.semantic?.call_id === "call-user-input",
    ),
  ).toBe(false);
  expect(
    trail.groups[0]!.entries.some(
      (e) => e.type === "tool_result" && e.semantic?.call_id === "call-user-input",
    ),
  ).toBe(false);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("request_user_input dismissed response emits empty answers", async () => {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) throw new Error("expected sessions dir");
  const dayDir = join(sessionsDir, "2026", "05", "28");
  mkdirSync(dayDir, { recursive: true });
  const path = join(dayDir, "rollout-dismissed-user-input-answer.jsonl");
  const lines = [
    {
      timestamp: "2026-05-28T12:30:00.000Z",
      type: "session_meta",
      payload: {
        id: "019d8b80-dddd-7000-a000-00000000000d",
        timestamp: "2026-05-28T12:30:00.000Z",
        cwd: process.cwd(),
        cli_version: "0.128.0",
      },
    },
    {
      timestamp: "2026-05-28T12:30:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "request_user_input",
        call_id: "call-user-input-large",
        arguments: '{"questions":[{"id":"ship","question":"Ship?"}]}',
      },
    },
    {
      timestamp: "2026-05-28T12:30:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-user-input-large",
        output: '{"answers":{}}',
      },
    },
  ];
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

  const trail = await codexAdapter.parseSession({
    id: "019d8b80-dddd-7000-a000-00000000000d",
    adapter: "codex",
    path,
  });
  const query = trail.groups[0]!.entries.find(
    (e) => e.type === "user_query" && e.semantic?.call_id === "call-user-input-large",
  );
  const response = trail.groups[0]!.entries.find(
    (e) => e.type === "user_query_response" && e.semantic?.call_id === "call-user-input-large",
  );

  expect(response?.payload).toEqual({ for_id: query?.id, answers: {} });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("custom_tool_call_output emits tool_result paired by call_id", async () => {
  const trail = await parseApplyPatchFixture();
  const singleCall = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-patch-single",
  );
  const singleResult = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_result" && e.semantic?.call_id === "call-patch-single",
  );
  expect(singleResult).toBeDefined();
  expect((singleResult?.payload as { for_id?: string }).for_id).toBe(singleCall?.id);
  expect((singleResult?.payload as { output: string }).output).toContain("M src/foo.ts");
  expect(singleResult?.meta?.["dev.codex.raw_type"]).toBe("response_item.custom_tool_call_output");
  const multiResult = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_result" && e.semantic?.call_id === "call-patch-multi",
  );
  expect(multiResult).toBeDefined();
});

test("custom_tool_call apply_patch with a multi-file patch maps to file_patch", async () => {
  const trail = await parseApplyPatchFixture();
  const multi = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-patch-multi",
  );
  expect(multi).toBeDefined();
  expect((multi?.payload as { tool: string }).tool).toBe("file_patch");
  const args = (
    multi?.payload as { args: { atomic: boolean; files: Array<{ path: string; diff: string }> } }
  ).args;
  expect(args.atomic).toBe(true);
  expect(args.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
  expect(args.files[0]?.diff).toContain("--- a/src/a.ts");
  expect(args.files[0]?.diff).toContain("-a");
  expect(args.files[0]?.diff).toContain("+A");
  expect(args.files[1]?.diff).toContain("--- a/src/b.ts");
  expect(args.files[1]?.diff).toContain("-b");
  expect(args.files[1]?.diff).toContain("+B");
});

test("custom_tool_call apply_patch with a single-file patch maps to file_edit", async () => {
  const trail = await parseApplyPatchFixture();
  const single = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "call-patch-single",
  );
  expect(single).toBeDefined();
  expect((single?.payload as { tool: string }).tool).toBe("file_edit");
  const args = (single?.payload as { args: { path: string; diff: string } }).args;
  expect(args.path).toBe("src/foo.ts");
  expect(args.diff).not.toContain("*** Update File: src/foo.ts");
  expect(args.diff).toContain("--- a/src/foo.ts");
  expect(args.diff).toContain("+++ b/src/foo.ts");
  expect(args.diff).toContain("-old line");
  expect(args.diff).toContain("+new line");
  expect(single?.meta?.["dev.codex.raw_type"]).toBe("response_item.custom_tool_call");
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("patchFiles uses move targets as destination paths", () => {
  expect(
    patchFiles(
      "*** Begin Patch\n*** Update File: src/old.ts\n*** Move to: src/new.ts\n@@\n-old\n+new\n*** End Patch",
    ),
  ).toEqual([
    {
      path: "src/new.ts",
      diff: "--- a/src/old.ts\n+++ b/src/new.ts\n@@\n-old\n+new",
    },
  ]);
});

test("patchFiles only treats line-start End Patch markers as patch terminators", () => {
  expect(
    patchFiles(
      "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+literal *** End Patch text\n*** End Patch",
    ),
  ).toEqual([
    {
      path: "src/a.ts",
      diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+literal *** End Patch text",
    },
  ]);
});

test("patchFiles synthesizes hunk headers for add and delete patch bodies", () => {
  expect(patchFiles("*** Begin Patch\n*** Add File: src/a.ts\n+one\n+two\n*** End Patch")).toEqual([
    {
      path: "src/a.ts",
      diff: "--- /dev/null\n+++ b/src/a.ts\n@@ -1,0 +1,2 @@\n+one\n+two",
    },
  ]);
  expect(
    patchFiles("*** Begin Patch\n*** Add File: src/a.ts\n++plus\n+literal @@ text\n*** End Patch"),
  ).toEqual([
    {
      path: "src/a.ts",
      diff: "--- /dev/null\n+++ b/src/a.ts\n@@ -1,0 +1,2 @@\n++plus\n+literal @@ text",
    },
  ]);
  expect(
    patchFiles("*** Begin Patch\n*** Delete File: src/a.ts\n-one\n-two\n*** End Patch"),
  ).toEqual([
    {
      path: "src/a.ts",
      diff: "--- a/src/a.ts\n+++ /dev/null\n@@ -1,2 +1,0 @@\n-one\n-two",
    },
  ]);
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

test("sourceVersion() reads cli_version from CRLF session head", async () => {
  seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id: "019d7909-85dd-7881-aa12-95ffc8ca8ba1",
    cwd: process.cwd(),
    cliVersion: "0.129.0",
    lineEnding: "\r\n",
  });

  expect(await codexAdapter.sourceVersion()).toBe("0.129.0");
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

test("detectSessions() reads id and cwd from CRLF session head", async () => {
  const id = "019d7909-85dd-7881-aa12-95ffc8ca8ba1";
  seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    lineEnding: "\r\n",
  });

  const refs = await codexAdapter.detectSessions();

  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({
    id,
    cwd: process.cwd(),
    headerStatus: "header",
  });
});

test("detectSessions() and parseSession() tolerate large session_meta records", async () => {
  const id = "019d7909-85dd-7881-aa12-95ffc8ca8ba1";
  seedSession({
    date: { y: "2026", m: "05", d: "28" },
    id,
    cwd: process.cwd(),
    extraPayload: { base_instructions: "x".repeat(22_000) },
  });
  const refs = await codexAdapter.detectSessions();
  expect(refs).toHaveLength(1);
  const [ref] = refs;
  expect(ref?.id).toBe(id);
  expect(ref?.cwd).toBe(process.cwd());
  expect(ref?.headerStatus).toBe("header");
  if (ref === undefined) throw new Error("expected ref");
  const trail = await codexAdapter.parseSession(ref);
  expect(trail.groups[0]!.header.id).toBe(id);
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
