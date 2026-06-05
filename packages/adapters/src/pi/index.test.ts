import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piAdapter, validateAdapterTrail } from "../index.ts";
import { ID_PATTERN } from "../test-helpers.ts";
import { cleanGitEnv } from "../vcs.ts";
// Adapter surface tests assert on the shape returned by parseSession. Entry ids
// are an internal detail of the kit engine, so tests locate entries by type and
// content and assert linkage via the found entries' own ids — never by a
// reconstructed id.
import { mangleCwd, piAgentDir, piProjectDir, piSessionsDir } from "./paths.ts";
import { parseLines } from "./source.ts";
import { toolKindAndArgs } from "./tools.ts";

let prevHome: string | undefined;
let prevUserProfile: string | undefined;
let prevPiAgentDir: string | undefined;
let prevPiSessionDir: string | undefined;
let prevCwd: string;
let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  prevPiSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  prevCwd = process.cwd();
  tmpHome = mkdtempSync(join(tmpdir(), "pi-adapter-home-"));
  tmpCwd = mkdtempSync(join(tmpdir(), "pi-adapter-cwd-"));
  process.env.HOME = tmpHome;
  delete process.env.USERPROFILE;
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  process.chdir(tmpCwd);
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = prevHome;
  }
  if (prevUserProfile === undefined) {
    delete process.env.USERPROFILE;
  } else {
    process.env.USERPROFILE = prevUserProfile;
  }
  if (prevPiAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = prevPiAgentDir;
  }
  if (prevPiSessionDir === undefined) {
    delete process.env.PI_CODING_AGENT_SESSION_DIR;
  } else {
    process.env.PI_CODING_AGENT_SESSION_DIR = prevPiSessionDir;
  }
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpCwd, { recursive: true, force: true });
});

function createProjectDir(): string {
  const sessionsDir = piSessionsDir();
  if (sessionsDir === undefined) throw new Error("test expected Pi sessions dir");
  const dir = piProjectDir({ sessionsDir, cwd: process.cwd() });
  mkdirSync(dir, { recursive: true });
  return dir;
}

const FIXTURE_PATH = new URL("../../tests/fixtures/pi/linear-flow.jsonl", import.meta.url).pathname;
const BRANCH_FIXTURE_PATH = new URL("../../tests/fixtures/pi/branch-flow.jsonl", import.meta.url)
  .pathname;
const REASONING_FIXTURE_PATH = new URL(
  "../../tests/fixtures/pi/reasoning-and-interrupt.jsonl",
  import.meta.url,
).pathname;
const COMPACT_FIXTURE_PATH = new URL(
  "../../tests/fixtures/pi/compaction-and-model-change.jsonl",
  import.meta.url,
).pathname;
const USAGE_FIXTURE_PATH = new URL("../../tests/fixtures/pi/usage-and-cost.jsonl", import.meta.url)
  .pathname;
const TOOL_RESULT_ERROR_FIXTURE_PATH = new URL(
  "../../tests/fixtures/pi/tool-result-error.jsonl",
  import.meta.url,
).pathname;
const QUARANTINE_FIXTURE_PATH = new URL("../../tests/fixtures/pi/quarantine.jsonl", import.meta.url)
  .pathname;
const SYSTEM_EVENTS_FIXTURE_PATH = new URL(
  "../../tests/fixtures/pi/system-events.jsonl",
  import.meta.url,
).pathname;
const LEAF_AND_LABEL_FIXTURE_PATH = new URL(
  "../../tests/fixtures/pi/leaf-and-label.jsonl",
  import.meta.url,
).pathname;
const BASH_EXECUTION_FIXTURE_PATH = new URL(
  "../../tests/fixtures/pi/bash-execution.jsonl",
  import.meta.url,
).pathname;
const CUSTOM_VARIANTS_FIXTURE_PATH = new URL(
  "../../tests/fixtures/pi/custom-message-variants.jsonl",
  import.meta.url,
).pathname;

async function parseFixture() {
  return piAdapter.parseSession({
    id: "linear-flow",
    adapter: "pi",
    path: FIXTURE_PATH,
  });
}

async function parseBranchFixture() {
  return piAdapter.parseSession({
    id: "branch-flow",
    adapter: "pi",
    path: BRANCH_FIXTURE_PATH,
  });
}

async function parseReasoningFixture() {
  return piAdapter.parseSession({
    id: "reasoning-and-interrupt",
    adapter: "pi",
    path: REASONING_FIXTURE_PATH,
  });
}

async function parseCompactFixture() {
  return piAdapter.parseSession({
    id: "compaction-and-model-change",
    adapter: "pi",
    path: COMPACT_FIXTURE_PATH,
  });
}

async function parseUsageFixture() {
  return piAdapter.parseSession({
    id: "usage-and-cost",
    adapter: "pi",
    path: USAGE_FIXTURE_PATH,
  });
}

async function parseToolResultErrorFixture() {
  return piAdapter.parseSession({
    id: "tool-result-error",
    adapter: "pi",
    path: TOOL_RESULT_ERROR_FIXTURE_PATH,
  });
}

async function parseQuarantineFixture() {
  return piAdapter.parseSession({
    id: "quarantine",
    adapter: "pi",
    path: QUARANTINE_FIXTURE_PATH,
  });
}

async function parseSystemEventsFixture() {
  return piAdapter.parseSession({
    id: "system-events",
    adapter: "pi",
    path: SYSTEM_EVENTS_FIXTURE_PATH,
  });
}

// TDD step 1: piAdapter name + TrailAdapter shape
test("piAdapter has name 'pi'", () => {
  expect(piAdapter.name).toBe("pi");
});

test("piAdapter parseSession emits a trail envelope", async () => {
  const trail = await parseFixture();
  expect(trail.envelope).toBeDefined();
  expect(trail.envelope?.type).toBe("trail");
  expect(trail.envelope?.schema_version).toBe("0.1.0");
  expect(trail.envelope?.producer).toMatch(/^@agent-trail\/adapters-pi\//);
  expect(typeof trail.envelope?.id).toBe("string");
  expect(typeof trail.envelope?.ts).toBe("string");
  expect(trail.envelope?.id).not.toBe(trail.groups[0]!.header.id);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("piAdapter implements TrailAdapter method surface", () => {
  expect(typeof piAdapter.detectSessions).toBe("function");
  expect(typeof piAdapter.parseSession).toBe("function");
  expect(typeof piAdapter.isAvailable).toBe("function");
  expect(typeof piAdapter.sourceVersion).toBe("function");
});

// TDD step 2: header building
test("parseSession() builds a header from session record id, ts, version (int->string), cwd", async () => {
  const trail = await parseFixture();
  const { session_uid, ...header } = trail.groups[0]!.header;
  expect(typeof session_uid).toBe("string");
  expect(session_uid).toMatch(
    /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/,
  );
  // session_uid is deterministic — re-parsing the same source yields the same uid.
  const reparsed = await parseFixture();
  expect(reparsed.groups[0]!.header.session_uid).toBe(session_uid);
  expect(header).toEqual({
    type: "session",
    schema_version: "0.1.0",
    id: "00000000-0000-0000-0000-eeeee0000001",
    ts: "2026-05-21T14:00:00.000Z",
    agent: { name: "pi", version: "3" },
    cwd: "/tmp/synthetic-project",
    source: {
      agent: "pi",
      format_version: "3",
    },
    parse_fidelity: { quarantined_count: 0 },
  });
});

// TDD step 3: user_message mapping
test("parseSession() emits a user_message for user role records with no parent_id when parentId is null", async () => {
  const trail = await parseFixture();
  const userMessage = trail.groups[0]!.entries.find((e) => e.type === "user_message");
  expect(userMessage).toBeDefined();
  expect(userMessage?.ts).toBe("2026-05-21T14:00:01.000Z");
  expect(userMessage?.payload).toEqual({ text: "please read spec.md" });
  expect(userMessage?.parent_id).toBeUndefined();
  expect(userMessage?.source?.original_type).toBe("message");
});

// TDD step 4: agent_message text mapping
test("parseSession() emits an agent_message for assistant text blocks with model and stop_reason", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.groups[0]!.entries.find((e) => e.type === "agent_message");
  const toolResult = trail.groups[0]!.entries.find((e) => e.type === "tool_result");
  expect(agentMsg).toBeDefined();
  // linear-flow chains user -> tool_call -> tool_result -> agent_message
  expect(agentMsg?.parent_id).toBe(toolResult?.id);
  expect(agentMsg?.payload).toEqual({
    text: "Spec loaded.",
    model: "claude-sonnet-4-5",
    stop_reason: "stop",
  });
});

test("parseSession() populates agent_message.payload.usage from message.usage on Pi assistant envelopes", async () => {
  const trail = await parseUsageFixture();
  const agentMsg = trail.groups[0]!.entries.find((e) => e.type === "agent_message");
  expect(agentMsg?.type).toBe("agent_message");
  // Real Pi `message.usage` keys (input/output/cacheRead/cacheWrite) map to the
  // spec usage fields. Pi has no cumulative/reasoning counters; `totalTokens` and
  // `cost` have no spec usage field (preserved under source.raw, surfaced as a
  // canonical field only once #116 lands).
  expect((agentMsg?.payload as Record<string, unknown>)?.usage).toEqual({
    input_tokens: 1234,
    output_tokens: 567,
    cache_read_tokens: 100,
    cache_creation_tokens: 50,
    context_input_tokens: 1384,
  });
  expect((agentMsg?.payload as { usage?: Record<string, unknown> })?.usage).not.toHaveProperty(
    "context_window_tokens",
  );
  expect(
    (agentMsg?.source?.raw as { envelope?: { message?: { usage?: unknown } } })?.envelope?.message
      ?.usage,
  ).toMatchObject({
    totalTokens: 1801,
    cost: 0.0123,
  });
});

test("parseSession() preserves Pi tool-result contextAtCompletion under vendor meta", async () => {
  const trail = await parseToolResultErrorFixture();
  const toolResult = trail.groups[0]!.entries.find((e) => e.type === "tool_result");
  expect(toolResult?.meta?.["dev.pi.context_at_completion"]).toEqual({
    tokens: 15909,
    contextWindow: 200000,
    percent: 7.9545,
  });
});

test("parseSession() omits payload.usage on agent_message when Pi envelope has no usage", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.groups[0]!.entries.find((e) => e.type === "agent_message");
  expect(agentMsg?.payload).not.toHaveProperty("usage");
});

// TDD step 5: tool_call mapping (read -> file_read)
test("parseSession() emits a tool_call for assistant toolCall blocks with semantic.call_id preserving toolCall.id", async () => {
  const trail = await parseFixture();
  const toolCall = trail.groups[0]!.entries.find((e) => e.type === "tool_call");
  const userMessage = trail.groups[0]!.entries.find((e) => e.type === "user_message");
  expect(toolCall).toBeDefined();
  expect(toolCall?.parent_id).toBe(userMessage?.id);
  expect(toolCall?.payload).toEqual({
    tool: "file_read",
    args: { path: "spec.md" },
  });
  expect(toolCall?.semantic).toEqual({
    call_id: "00000000-0000-0000-0000-dddddccccc01",
    tool_kind: "file_read",
  });
});

// TDD step 6: tool_result pairing via toolCallId
test("parseSession() emits a tool_result for toolResult envelopes linked via toolCallId to the tool_call event id", async () => {
  const trail = await parseFixture();
  const toolResult = trail.groups[0]!.entries.find((e) => e.type === "tool_result");
  const toolCall = trail.groups[0]!.entries.find((e) => e.type === "tool_call");
  expect(toolResult).toBeDefined();
  expect(toolResult?.parent_id).toBe(toolCall?.id);
  expect(toolResult?.payload).toEqual({
    for_id: toolCall?.id,
    ok: true,
    output: "# Agent Trail Specification\n",
  });
  expect(toolResult?.semantic).toEqual({
    call_id: "00000000-0000-0000-0000-dddddccccc01",
    tool_kind: "file_read",
  });
});

// TDD step 7: multi-entry assistant envelope chained via localParentId
// TDD step 8: full fixture round-trips through validation with zero errors
test("linear-flow fixture round-trips through validateAdapterTrail with zero error diagnostics", async () => {
  const trail = await parseFixture();
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

// TDD step 9: canonical entry types only
test("linear-flow fixture emits only canonical event types in source order", async () => {
  const trail = await parseFixture();
  expect(trail.groups[0]!.entries.map((e) => e.type)).toEqual([
    "user_message",
    "tool_call",
    "tool_result",
    "agent_message",
  ]);
});

test("parseSession() emits v0.1-shaped deterministic entry ids across representative fixtures", async () => {
  const first = await parseFixture();
  const second = await parseFixture();
  expect(first.groups[0]!.entries.map((e) => e.id)).toEqual(
    second.groups[0]!.entries.map((e) => e.id),
  );
  for (const entry of first.groups[0]!.entries) expect(entry.id).toMatch(ID_PATTERN);

  const stateful = await parseReasoningFixture();
  const statefulAgain = await parseReasoningFixture();
  expect(stateful.groups[0]!.entries.map((e) => e.id)).toEqual(
    statefulAgain.groups[0]!.entries.map((e) => e.id),
  );
  for (const entry of stateful.groups[0]!.entries) expect(entry.id).toMatch(ID_PATTERN);
  expect(stateful.groups[0]!.entries.some((e) => e.type === "user_interrupt")).toBe(true);
  expect(stateful.groups[0]!.entries.some((e) => e.type === "session_terminated")).toBe(true);
  expect(stateful.groups[0]!.header.parse_fidelity).toEqual({
    quarantined_count: 0,
    termination_reason: "eof_with_open_tool_calls",
  });
});

test("every entry carries source metadata: agent='pi', original_type set, schema_version stringified, raw preserved", async () => {
  const trail = await parseFixture();
  for (const entry of trail.groups[0]!.entries) {
    expect(entry.source?.agent).toBe("pi");
    expect(typeof entry.source?.original_type).toBe("string");
    expect(entry.source?.schema_version).toBe("3");
    expect(entry.source?.raw).toBeDefined();
  }
});

// TDD step 10: detectSessions
test("isAvailable() is false when project dir does not exist", async () => {
  expect(await piAdapter.isAvailable()).toBe(false);
});

test("isAvailable() is true after project dir is created", async () => {
  mkdirSync(createProjectDir(), { recursive: true });
  expect(await piAdapter.isAvailable()).toBe(true);
});

test("mangleCwd() wraps cwd with '--...--' and replaces path separators with '-'", () => {
  expect(mangleCwd("/Users/somu/Code")).toBe("--Users-somu-Code--");
  expect(mangleCwd("/Users/somu/Code/agent-trail")).toBe("--Users-somu-Code-agent-trail--");
  expect(mangleCwd("/")).toBe("----");
});

test("isAvailable() falls back to USERPROFILE when HOME is unset", async () => {
  delete process.env.HOME;
  process.env.USERPROFILE = tmpHome;
  mkdirSync(createProjectDir(), { recursive: true });
  expect(await piAdapter.isAvailable()).toBe(true);
});

test("piAgentDir() defaults to $HOME/.pi/agent (matches pi-mono getAgentDir())", () => {
  expect(piAgentDir()).toBe(join(tmpHome, ".pi", "agent"));
});

test("piSessionsDir() defaults to <agentDir>/sessions", () => {
  expect(piSessionsDir()).toBe(join(tmpHome, ".pi", "agent", "sessions"));
});

test("piAgentDir() honors PI_CODING_AGENT_DIR override", () => {
  process.env.PI_CODING_AGENT_DIR = "/custom/pi-agent";
  expect(piAgentDir()).toBe("/custom/pi-agent");
  expect(piSessionsDir()).toBe(join("/custom/pi-agent", "sessions"));
});

test("piSessionsDir() honors PI_CODING_AGENT_SESSION_DIR override independently of agent dir", () => {
  process.env.PI_CODING_AGENT_DIR = "/custom/pi-agent";
  process.env.PI_CODING_AGENT_SESSION_DIR = "/elsewhere/sessions";
  expect(piSessionsDir()).toBe("/elsewhere/sessions");
});

test("detectSessions() honors PI_CODING_AGENT_DIR override", async () => {
  const customAgentDir = mkdtempSync(join(tmpdir(), "pi-adapter-agent-"));
  process.env.PI_CODING_AGENT_DIR = customAgentDir;
  try {
    const dir = createProjectDir();
    writeFileSync(join(dir, "sess-custom.jsonl"), "");
    const sessions = await piAdapter.detectSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "sess-custom",
      adapter: "pi",
      path: join(dir, "sess-custom.jsonl"),
    });
  } finally {
    rmSync(customAgentDir, { recursive: true, force: true });
  }
});

test("detectSessions() honors PI_CODING_AGENT_SESSION_DIR override", async () => {
  const customSessionsDir = mkdtempSync(join(tmpdir(), "pi-adapter-sessions-"));
  process.env.PI_CODING_AGENT_SESSION_DIR = customSessionsDir;
  try {
    const dir = createProjectDir();
    writeFileSync(join(dir, "sess-custom.jsonl"), "");
    const sessions = await piAdapter.detectSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "sess-custom",
      adapter: "pi",
      path: join(dir, "sess-custom.jsonl"),
    });
  } finally {
    rmSync(customSessionsDir, { recursive: true, force: true });
  }
});

test("detectSessions() populates cwd from session header and modifiedAt from file mtime", async () => {
  const dir = createProjectDir();
  const file = join(dir, "sess-h.jsonl");
  const header = { type: "session", cwd: "/tmp/pi-proj" };
  writeFileSync(file, `${JSON.stringify(header)}\n`);
  const mtime = new Date("2026-05-17T14:00:00.000Z");
  utimesSync(file, mtime, mtime);
  const refs = await piAdapter.detectSessions();
  expect(refs).toHaveLength(1);
  expect(refs[0]).toEqual({
    id: "sess-h",
    adapter: "pi",
    path: file,
    cwd: "/tmp/pi-proj",
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
});

test("detectSessions({ allCwds: true }) walks every project dir under sessions root", async () => {
  const sessionsDir = piSessionsDir();
  if (sessionsDir === undefined) throw new Error("test expected Pi sessions dir");
  const dirA = join(sessionsDir, "--tmp-proj-a--");
  const dirB = join(sessionsDir, "--tmp-proj-b--");
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  writeFileSync(
    join(dirA, "sess-a.jsonl"),
    `${JSON.stringify({ type: "session", cwd: "/tmp/proj/a" })}\n`,
  );
  writeFileSync(
    join(dirB, "sess-b.jsonl"),
    `${JSON.stringify({ type: "session", cwd: "/tmp/proj/b" })}\n`,
  );
  const refs = await piAdapter.detectSessions({ allCwds: true });
  const byId = [...refs].sort((a, b) => a.id.localeCompare(b.id));
  expect(byId.map((r) => ({ id: r.id, cwd: r.cwd }))).toEqual([
    { id: "sess-a", cwd: "/tmp/proj/a" },
    { id: "sess-b", cwd: "/tmp/proj/b" },
  ]);
});

test("detectSessions() returns empty when project dir is missing", async () => {
  expect(await piAdapter.detectSessions()).toEqual([]);
});

test("detectSessions() returns one SessionRef per .jsonl file, skipping other extensions", async () => {
  const dir = createProjectDir();
  writeFileSync(join(dir, "sess-a.jsonl"), "");
  writeFileSync(join(dir, "sess-b.jsonl"), "");
  writeFileSync(join(dir, "ignore.txt"), "");
  const refs = await piAdapter.detectSessions();
  const sorted = [...refs].sort((a, b) => a.id.localeCompare(b.id));
  expect(sorted.map((r) => r.id)).toEqual(["sess-a", "sess-b"]);
});

test("parseSession() rejects non-object JSONL records instead of silently skipping them", async () => {
  const dir = createProjectDir();
  const file = join(dir, "non-object.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "00000000-0000-0000-0000-eeeee0000100",
      timestamp: "2026-05-21T14:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    })}\n"hidden"\n`,
  );

  await expect(
    piAdapter.parseSession({ id: "non-object", adapter: "pi", path: file }),
  ).rejects.toThrow(/expected JSON object on line 2/);
});

test("parseSession() rejects array JSONL records instead of quarantining them", async () => {
  const dir = createProjectDir();
  const file = join(dir, "array-record.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "00000000-0000-0000-0000-eeeee0000101",
      timestamp: "2026-05-21T14:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    })}\n[]\n`,
  );

  await expect(piAdapter.parseSession({ id: "array", adapter: "pi", path: file })).rejects.toThrow(
    /expected JSON object on line 2/,
  );
});

test("parseLines() reports malformed JSONL with a line number", () => {
  expect(() => parseLines('{"type":"session"}\r\n{"type":')).toThrow(
    /JsonlReader: failed to parse JSON on line 2:/,
  );
});

test("parseLines() tolerates CRLF blank lines", () => {
  expect(parseLines('{"type":"session"}\r\n\r\n')).toEqual([{ type: "session" }]);
});

test("parseSession() stamps timestamp-less drift quarantine from the session header", async () => {
  const dir = createProjectDir();
  const file = join(dir, "timestamp-less-drift.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "00000000-0000-0000-0000-eeeee0000101",
      timestamp: "2026-05-21T14:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    })}\n${JSON.stringify({
      type: "plugin_blob",
      id: "00000000-0000-0000-0000-eeeee0000102",
      parentId: null,
      blob: { opaque: "data" },
    })}\n`,
  );

  const trail = await piAdapter.parseSession({
    id: "timestamp-less-drift",
    adapter: "pi",
    path: file,
  });
  const quarantine = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/unknown_record",
  );
  expect(quarantine?.ts).toBe("2026-05-21T14:00:00.000Z");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() preserves Pi tree parenting through quarantined source records", async () => {
  const trail = await parseQuarantineFixture();
  expect(trail.groups[0]!.entries.map((e) => e.type)).toEqual([
    "user_message",
    "system_event",
    "agent_message",
  ]);

  const user = trail.groups[0]!.entries[0];
  const quarantine = trail.groups[0]!.entries[1];
  const agent = trail.groups[0]!.entries[2];

  expect(user?.parent_id).toBeUndefined();
  expect((quarantine?.payload as { kind?: string }).kind).toBe("x-pi/unknown_record");
  expect(quarantine?.parent_id).toBe(user?.id);
  expect(agent?.parent_id).toBe(user?.id);
  expect(trail.groups[0]!.header.parse_fidelity).toEqual({ quarantined_count: 1 });

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() preserves Pi tree parenting through dropped known source records", async () => {
  const dir = createProjectDir();
  const file = join(dir, "dropped-known-parent.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: "00000000-0000-0000-0000-eeeee0000103",
      timestamp: "2026-05-21T14:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    })}\n${JSON.stringify({
      type: "message",
      id: "00000000-0000-0000-0000-eeeee0000104",
      parentId: null,
      timestamp: "2026-05-21T14:00:01.000Z",
      message: { role: "user", content: "hello" },
    })}\n${JSON.stringify({
      type: "model_change",
      id: "00000000-0000-0000-0000-eeeee0000105",
      parentId: "00000000-0000-0000-0000-eeeee0000104",
      timestamp: "2026-05-21T14:00:02.000Z",
    })}\n${JSON.stringify({
      type: "message",
      id: "00000000-0000-0000-0000-eeeee0000106",
      parentId: "00000000-0000-0000-0000-eeeee0000105",
      timestamp: "2026-05-21T14:00:03.000Z",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        stopReason: "stop",
        content: "hi there",
      },
    })}\n`,
  );

  const trail = await piAdapter.parseSession({
    id: "dropped-known-parent",
    adapter: "pi",
    path: file,
  });
  expect(trail.groups[0]!.entries.map((e) => e.type)).toEqual(["user_message", "agent_message"]);
  const user = trail.groups[0]!.entries[0];
  const agent = trail.groups[0]!.entries[1];
  expect(agent?.parent_id).toBe(user?.id);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

// TDD step 12: sourceVersion
test("sourceVersion() is null when no sessions exist", async () => {
  expect(await piAdapter.sourceVersion()).toBeNull();
});

test("sourceVersion() reads the version field from the most recent session and stringifies integers", async () => {
  const dir = createProjectDir();
  const olderPath = join(dir, "older.jsonl");
  const newerPath = join(dir, "newer.jsonl");
  writeFileSync(
    olderPath,
    `${JSON.stringify({ type: "session", version: 2, id: "older", timestamp: "2026-05-21T14:00:00.000Z" })}\n`,
  );
  writeFileSync(
    newerPath,
    `${JSON.stringify({ type: "session", version: 3, id: "newer", timestamp: "2026-05-21T15:00:00.000Z" })}\n`,
  );
  const olderMtime = new Date("2026-05-21T14:00:00.000Z");
  const newerMtime = new Date("2026-05-21T15:00:00.000Z");
  utimesSync(olderPath, olderMtime, olderMtime);
  utimesSync(newerPath, newerMtime, newerMtime);
  expect(await piAdapter.sourceVersion()).toBe("3");
});

// TDD step 13: tool taxonomy coverage
test("toolKindAndArgs maps Pi 'read' -> file_read", () => {
  expect(toolKindAndArgs("read", { path: "a.md" })).toEqual({
    tool: "file_read",
    args: { path: "a.md" },
  });
  expect(toolKindAndArgs("read", { path: "a.md", offset: 10, limit: 5 })).toEqual({
    tool: "file_read",
    args: { path: "a.md", range: [10, 15] },
  });
});

test("toolKindAndArgs maps Pi 'write' -> file_write", () => {
  expect(toolKindAndArgs("write", { path: "a.md", content: "hi" })).toEqual({
    tool: "file_write",
    args: { path: "a.md", content: "hi" },
  });
});

test("toolKindAndArgs emits spec-conformant unified-diff hunk header (@@ -1,<oldN> +1,<newN> @@)", () => {
  // Spec §10.1 example: `@@ -1,4 +1,4 @@`. Pi edit shapes carry no line numbers,
  // so start lines are synthetic (1) but line counts are accurate.
  const result = toolKindAndArgs("edit", { path: "x.md", oldText: "a\nb", newText: "c" });
  const args = (result as { args: { diff: string } }).args;
  expect(args.diff).toContain("@@ -1,2 +1,1 @@");
});

test("toolKindAndArgs builds a valid unified diff for multi-line oldText/newText (prefixes every line)", () => {
  const result = toolKindAndArgs("edit", {
    path: "a.md",
    oldText: "line1\nline2\nline3",
    newText: "newA\nnewB",
  });
  expect(result.tool).toBe("file_edit");
  const args = result.args as { diff: string };
  expect(args.diff).toBe(
    "--- a/a.md\n+++ b/a.md\n@@ -1,3 +1,2 @@\n-line1\n-line2\n-line3\n+newA\n+newB",
  );
});

test("toolKindAndArgs handles pure-insertion edit (empty oldText, multi-line newText)", () => {
  const result = toolKindAndArgs("edit", { path: "a.md", oldText: "", newText: "hi\nthere" });
  const args = (result as { args: { diff: string } }).args;
  expect(args.diff).toBe("--- a/a.md\n+++ b/a.md\n@@ -1,0 +1,2 @@\n+hi\n+there");
});

test("toolKindAndArgs handles pure-deletion edit (multi-line oldText, empty newText)", () => {
  const result = toolKindAndArgs("edit", { path: "a.md", oldText: "del1\ndel2", newText: "" });
  const args = (result as { args: { diff: string } }).args;
  expect(args.diff).toBe("--- a/a.md\n+++ b/a.md\n@@ -1,2 +1,0 @@\n-del1\n-del2");
});

test("toolKindAndArgs maps Pi 'edit' single-replace ({path, oldText, newText}) -> file_edit", () => {
  expect(toolKindAndArgs("edit", { path: "a.md", oldText: "foo", newText: "bar" })).toEqual({
    tool: "file_edit",
    args: {
      path: "a.md",
      diff: "--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n-foo\n+bar",
    },
  });
});

test("toolKindAndArgs maps current pi-mono 'edit' shape ({path, edits:[{oldText,newText}]}) -> file_edit", () => {
  expect(
    toolKindAndArgs("edit", {
      path: "a.md",
      edits: [
        { oldText: "foo", newText: "bar" },
        { oldText: "baz", newText: "qux" },
      ],
    }),
  ).toEqual({
    tool: "file_edit",
    args: {
      path: "a.md",
      diff: "--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n-foo\n+bar\n@@ -1,1 +1,1 @@\n-baz\n+qux",
    },
  });
});

test("toolKindAndArgs maps Pi 'edit' multi same-path -> file_edit with concatenated diff", () => {
  expect(
    toolKindAndArgs("edit", {
      multi: [
        { path: "a.md", oldText: "foo", newText: "bar" },
        { path: "a.md", oldText: "baz", newText: "qux" },
      ],
    }),
  ).toEqual({
    tool: "file_edit",
    args: {
      path: "a.md",
      diff: "--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n-foo\n+bar\n@@ -1,1 +1,1 @@\n-baz\n+qux",
    },
  });
});

test("toolKindAndArgs maps Pi 'edit' multi across multiple files -> file_patch", () => {
  expect(
    toolKindAndArgs("edit", {
      multi: [
        { path: "a.md", oldText: "foo", newText: "bar" },
        { path: "b.md", oldText: "baz", newText: "qux" },
      ],
    }),
  ).toEqual({
    tool: "file_patch",
    args: {
      files: [
        {
          path: "a.md",
          diff: "--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n-foo\n+bar",
        },
        {
          path: "b.md",
          diff: "--- a/b.md\n+++ b/b.md\n@@ -1,1 +1,1 @@\n-baz\n+qux",
        },
      ],
      atomic: true,
    },
  });
});

test("toolKindAndArgs maps Pi 'edit' apply_patch shape -> file_edit or file_patch", () => {
  expect(
    toolKindAndArgs("edit", {
      patch: "*** Begin Patch\n*** Update File: x.md\n@@\n-a\n+b\n*** End Patch",
    }),
  ).toEqual({
    tool: "file_edit",
    args: { path: "x.md", diff: "--- a/x.md\n+++ b/x.md\n@@\n-a\n+b" },
  });
  expect(
    toolKindAndArgs("edit", {
      patch:
        "*** Begin Patch\n*** Update File: x.md\n@@\n-a\n+literal *** End Patch text\n*** End Patch",
    }),
  ).toEqual({
    tool: "file_edit",
    args: {
      path: "x.md",
      diff: "--- a/x.md\n+++ b/x.md\n@@\n-a\n+literal *** End Patch text",
    },
  });
  expect(
    toolKindAndArgs("edit", {
      patch:
        "*** Begin Patch\n*** Update File: x.md\n@@\n-a\n+b\n*** Update File: y.md\n@@\n-c\n+d\n*** End Patch",
    }),
  ).toEqual({
    tool: "file_patch",
    args: {
      files: [
        { path: "x.md", diff: "--- a/x.md\n+++ b/x.md\n@@\n-a\n+b" },
        { path: "y.md", diff: "--- a/y.md\n+++ b/y.md\n@@\n-c\n+d" },
      ],
      atomic: true,
    },
  });
  expect(
    toolKindAndArgs("edit", {
      patch:
        "*** Begin Patch\n*** Update File: old.md\n*** Move to: new.md\n@@\n-a\n+b\n*** End Patch",
    }),
  ).toEqual({
    tool: "file_edit",
    args: { path: "new.md", diff: "--- a/old.md\n+++ b/new.md\n@@\n-a\n+b" },
  });
  expect(
    toolKindAndArgs("edit", {
      patch: "*** Begin Patch\n*** Add File: x.md\n+one\n+two\n*** End Patch",
    }),
  ).toEqual({
    tool: "file_edit",
    args: {
      path: "x.md",
      diff: "--- /dev/null\n+++ b/x.md\n@@ -1,0 +1,2 @@\n+one\n+two",
    },
  });
});

test("toolKindAndArgs tolerates legacy Pi 'edit' (oldString/newString) for back-compat", () => {
  expect(toolKindAndArgs("edit", { path: "a.md", oldString: "foo", newString: "bar" })).toEqual({
    tool: "file_edit",
    args: {
      path: "a.md",
      diff: "--- a/a.md\n+++ b/a.md\n@@ -1,1 +1,1 @@\n-foo\n+bar",
    },
  });
});

test("toolKindAndArgs maps Pi 'bash' -> shell_command", () => {
  expect(toolKindAndArgs("bash", { command: "ls" })).toEqual({
    tool: "shell_command",
    args: { command: "ls" },
  });
});

test("toolKindAndArgs maps Pi 'grep' -> file_search with pattern/path/glob", () => {
  expect(toolKindAndArgs("grep", { pattern: "TODO", path: "src", glob: "*.ts" })).toEqual({
    tool: "file_search",
    args: { query: "TODO", path: "src", glob: "*.ts" },
  });
});

test("toolKindAndArgs maps Pi 'find' -> file_search with pattern/path", () => {
  expect(toolKindAndArgs("find", { pattern: "*.md", path: "docs" })).toEqual({
    tool: "file_search",
    args: { query: "*.md", path: "docs" },
  });
});

test("toolKindAndArgs maps Pi 'ls' -> file_list", () => {
  expect(toolKindAndArgs("ls", { path: "src" })).toEqual({
    tool: "file_list",
    args: { path: "src" },
  });
  expect(toolKindAndArgs("ls", {})).toEqual({
    tool: "file_list",
    args: { path: "." },
  });
  expect(toolKindAndArgs("ls", { path: "dir with space" })).toEqual({
    tool: "file_list",
    args: { path: "dir with space" },
  });
});

test("toolKindAndArgs keeps literal Pi 'ls' paths beginning with '-'", () => {
  expect(toolKindAndArgs("ls", { path: "-rf" })).toEqual({
    tool: "file_list",
    args: { path: "-rf" },
  });
});

test("toolKindAndArgs falls back to 'other' for non-built-in tool names (e.g., MCP extensions)", () => {
  expect(toolKindAndArgs("custom_mcp_tool", { foo: "bar" })).toEqual({
    tool: "other",
    args: { name: "custom_mcp_tool", args: { foo: "bar" } },
  });
});

test("Pi extension-like tool calls do not synthesize capability_change events", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pi-capability-noop-"));
  const path = join(tmp, "session.jsonl");
  try {
    const lines = [
      {
        type: "session",
        version: 3,
        id: "00000000-0000-0000-0000-000000000128",
        timestamp: "2026-06-01T02:00:00.000Z",
        cwd: "/tmp/synthetic-project",
      },
      {
        type: "message",
        id: "00000000-0000-0000-0000-000000128001",
        parentId: null,
        timestamp: "2026-06-01T02:00:01.000Z",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: "00000000-0000-0000-0000-000000128002",
              name: "custom_mcp_tool",
              arguments: { foo: "bar" },
            },
          ],
        },
      },
    ];
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const trail = await piAdapter.parseSession({
      id: "00000000-0000-0000-0000-000000000128",
      adapter: "pi",
      path,
    });
    expect(trail.groups[0]!.entries.some((entry) => entry.type === "capability_change")).toBe(
      false,
    );
    const call = trail.groups[0]!.entries.find((entry) => entry.type === "tool_call");
    expect(call?.payload).toEqual({
      tool: "other",
      args: { name: "custom_mcp_tool", args: { foo: "bar" } },
    });
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Issue #19: tree branch semantics (spec §12.1-12.3, §9.3 branch_summary)

// TDD step 1: fixture loads and validates end-to-end
test("branch-flow fixture round-trips through validateAdapterTrail with zero error diagnostics", async () => {
  const trail = await parseBranchFixture();
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

// TDD step 2: forked parentId graph produces multiple entries sharing one parent_id
test("branch-flow produces a fork at pi-a1: two user_messages share it as parent_id", async () => {
  const trail = await parseBranchFixture();
  const entries = trail.groups[0]!.entries;
  const byParent = new Map<string, typeof entries>();
  for (const e of entries) {
    if (typeof e.parent_id !== "string") continue;
    const group = byParent.get(e.parent_id) ?? [];
    group.push(e);
    byParent.set(e.parent_id, group);
  }
  // One fork: a parent (pi-a1) with two user_message children (pi-u2, pi-u3).
  // The fork point also parents the branch_summary, so filter children by type.
  const fork = [...byParent.values()].find(
    (children) => children.filter((e) => e.type === "user_message").length === 2,
  );
  expect(fork).toBeDefined();
});

// TDD step 3: branch_summary envelope produces a branch_summary entry with payload.summary
test("branch-flow emits a branch_summary entry carrying payload.summary from the Pi envelope", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.groups[0]!.entries.find((e) => e.type === "branch_summary");
  expect(branchSummary).toBeDefined();
  expect((branchSummary?.payload as { summary?: string }).summary).toBe(
    "Explored X, switching to Y.",
  );
});

// TDD step 4: branch_summary entry's parent_id is the fork point (pi-a1), same as the user messages.
test("branch-flow branch_summary entry has parent_id resolved to the fork point (pi-a1)", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.groups[0]!.entries.find((e) => e.type === "branch_summary");
  // The fork point is the parent shared by the two user_message children.
  const entries = trail.groups[0]!.entries;
  const byParent = new Map<string, typeof entries>();
  for (const e of entries) {
    if (typeof e.parent_id !== "string") continue;
    const group = byParent.get(e.parent_id) ?? [];
    group.push(e);
    byParent.set(e.parent_id, group);
  }
  const forkParentId = [...byParent.entries()].find(
    ([, children]) => children.filter((e) => e.type === "user_message").length === 2,
  )?.[0];
  expect(forkParentId).toBeDefined();
  expect(branchSummary?.parent_id).toBe(forkParentId);
});

// TDD step 5: abandoned_branch_id resolves to the root of the abandoned branch (pi-u2) —
// one of the fork's user_message children, and a real emitted entry.
test("branch-flow branch_summary.abandoned_branch_id resolves to a fork-child user_message", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.groups[0]!.entries.find((e) => e.type === "branch_summary");
  const payload = branchSummary?.payload as { abandoned_branch_id?: string };
  const abandoned = trail.groups[0]!.entries.find((e) => e.id === payload.abandoned_branch_id);
  expect(abandoned).toBeDefined();
  expect(abandoned?.type).toBe("user_message");
  // It is one of the two forked children (the abandoned side, not the active path).
  expect(abandoned?.parent_id).toBe(branchSummary?.parent_id);
});

// TDD step 6: source.raw preserves the original Pi envelope (fromId, summary, details)
test("branch-flow branch_summary entry preserves the original envelope under source.raw", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.groups[0]!.entries.find((e) => e.type === "branch_summary");
  const raw = branchSummary?.source?.raw as Record<string, unknown>;
  expect(raw?.type).toBe("branch_summary");
  expect(raw?.fromId).toBe("00000000-0000-0000-0000-bbbbbbbb0002");
  expect(raw?.summary).toBe("Explored X, switching to Y.");
  expect(raw?.details).toEqual({ readFiles: ["spec.md"], modifiedFiles: ["x.md"] });
});

// TDD step 7: Pi branch_summary.details surface in entry.meta under reverse-domain key (spec §8.0.3 / §11)
test("branch-flow branch_summary entry mirrors Pi details into meta['dev.pi.branch_details']", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.groups[0]!.entries.find((e) => e.type === "branch_summary");
  const meta = branchSummary?.meta as Record<string, unknown> | undefined;
  expect(meta).toBeDefined();
  expect(meta?.["dev.pi.branch_details"]).toEqual({
    readFiles: ["spec.md"],
    modifiedFiles: ["x.md"],
  });
});

// TDD step 8: degenerate case — fromId is an ancestor of the active leaf.
// Divergence walk can't refine; fall back to fromId's resolved entry id so the entry stays valid.
// Real-session smoke regression: pi-mono can set fromId to an envelope type the adapter doesn't
// emit (session_info, model_change, custom, ...). When walking the abandoned chain hits a source id
// with no entry, the resolver must keep walking — never emit an abandoned_branch_id that no entry
// in the file actually carries.
// TDD step 9: degenerate case — fromId references no envelope id in the file.
// Walk produces no shared ancestor; fall back to the verbatim fromId string so payload stays valid.
// Codex P1 (multi-branch) regression: with two `/tree` navigations in one session, each summary
// must be resolved against ITS OWN local active leaf (the arrival point at the time it was
// written), not the final file leaf. Otherwise an earlier summary gets reinterpreted using a
// later branch's state.
//
// Tree shape:
//   u-root
//   ├── a-A1 → u-A2 → a-A3   (abandoned by bs-1)
//   ├── a-B1 → u-B2 → a-B3   (active after bs-1, abandoned by bs-2)
//   └── a-C1 → u-C2 → a-C3   (active after bs-2 — final file leaf)
//
// bs-1: fromId=a-A3, parentId=a-B1  → active leaf at write time = a-B1; root of abandoned = a-A1.
// bs-2: fromId=a-B3, parentId=a-C1  → active leaf at write time = a-C1; root of abandoned = a-B1.
//
// Before the fix, both summaries shared the file-final active leaf (descendant of a-C1), so
// bs-1's abandoned path (rooted at a-A1) shares an ancestor only at u-root with that active
// path; algorithm picks the correct root by luck. The clearer failure is bs-2: its abandoned
// branch (a-B1) is a sibling of the active branch (a-C1), and the SHARED active leaf still
// works for bs-2 too. So we need a sharper shape: bs-2's abandoned branch must be deeper than
// the global active leaf would imply. Make bs-2 abandon the C branch in favor of A — i.e.
// re-activate A — so the global active leaf (a-A3) misroots bs-2.
// Codex P2 regression: when the divergence node on the abandoned side is a Pi envelope that fans
// out into multiple Agent Trail entries (text + toolCall blocks in one assistant envelope),
// `abandoned_branch_id` must point at the **first** emitted entry of that envelope (the entry
// directly under the divergence parent), not the **last** entry. Returning the last entry
// misanchors the abandoned-branch root deeper than spec §9.3 intends and confuses tree renderers.
// Codex P1 regression: when the last envelope in source order is an unmapped type (session_info,
// label, model_change…), it must NOT be treated as the active leaf — those envelopes don't
// participate in the emitted entry graph, and using one collapses the shared-ancestor walk.
// File ends with trailing session_info; active leaf must be the prior `a-2` message envelope so
// the divergence walk against fromId=a-1 still returns u-abandon (root of abandoned branch).
// Issue #20: Pi optional events + cross-cutting hardenings

// Slice 1: agent_thinking from assistant `thinking` content block (pi-ai ThinkingContent)
// Slice 2: redacted-thinking placeholder (mirror claude-code adapter — text is opaque)
// Slice 3: synthesized user_interrupt for assistant envelopes with stopReason === "aborted"
// (pi-ai `StopReason = ... | "aborted"` indicates the user interrupted mid-response).
// Slice 3b: aborted with no emittable blocks — interrupt still synthesized; parent_id falls back
// to the envelope's parentId so the entry stays in the tree.
// Slice 4: context_compact from Pi `compaction` envelope (pi-mono session-manager `CompactionEntry`)
// Slice 4b: tokensBefore as numeric string coerces to a tokens_before number (defense-in-depth,
// matches timestampToIso() polymorphic-parse philosophy).
// PR #59 review (codex): missing/non-string `summary` on a `compaction` envelope must NOT emit a
// context_compact with an invented empty summary — downstream consumers can no longer distinguish
// a real empty summary from missing source data. Drop the entry instead.
// Slice 5: model_change from Pi `model_change` envelope (pi-mono session-manager `ModelChangeEntry`).
// from_model is the last assistant.message.model observed (or last model_change.modelId).
// Slice 5b: first model_change with no prior assistant — emit to_model only (no from_model).
// PR #59 review (codex): prevModel must only advance when the envelope actually emitted entries.
// Otherwise a missing-timestamp / dropped assistant or model_change can taint the next
// model_change's from_model with a value that never appears in the trail.
// Slice 6: polymorphic timestamp parser. Pi top-level envelopes are ISO today, but pi-mono
// internal messages (BashExecutionMessage, CompactionSummaryMessage) carry timestamp: Unix ms.
// Defense-in-depth: accept ISO string OR Unix ms (number/numeric string) at envelope boundary
// and emit a canonical ISO `ts`.
// PR #59 review (codex): guard against out-of-range numeric timestamps. `new Date(...).toISOString()`
// throws RangeError for values outside JS Date's ±100M-day range (e.g., nanosecond-epoch values).
// One malformed envelope must not abort parsing for the whole session.
test("polymorphic timestamp: out-of-range Unix-ms numeric string returns undefined", async () => {
  const { timestampToIso } = await import("./source.ts");
  expect(timestampToIso(`1${"0".repeat(40)}`)).toBeUndefined();
});

// Slice 7: defensive bash arg shapes (Codex pattern). Pi 'bash' may arrive as
// `{command:"..."}`, `{cmd:"..."}`, or `{command:["bash","-lc","..."]}`. All three
// must map to shell_command with a single canonical command string.
test("toolKindAndArgs maps Pi 'bash' with {command:[...]} (string-array) to a shell-quoted command", () => {
  expect(toolKindAndArgs("bash", { command: ["bash", "-lc", "echo hi"] })).toEqual({
    tool: "shell_command",
    args: { command: "bash -lc 'echo hi'" },
  });
});

test("toolKindAndArgs maps Pi 'bash' with {cmd:'...'} to shell_command (already covered by stringValue fallback)", () => {
  expect(toolKindAndArgs("bash", { cmd: "echo hi" })).toEqual({
    tool: "shell_command",
    args: { command: "echo hi" },
  });
});

// Slice 8: per-event `dev.pi.raw_type` audit tag (OpenCode pattern). Each emitted entry carries a
// short tag in `metadata["dev.pi.raw_type"]` describing which source variant produced it — kept
// under reverse-DNS metadata since schema sourceMetadata is closed (additionalProperties:false).
// Slice 9: numeric tool-ID coercion (Cursor pattern). Pi-ai types ToolCall.id as string, but
// defense-in-depth: a non-conforming source emitting a numeric id must be coerced to a string
// canonical id before it can leak into semantic.call_id / tool_result.for_id.
// Fixture-driven: reasoning-and-interrupt.jsonl validates end-to-end and covers thinking + interrupt
test("reasoning-and-interrupt fixture round-trips through validateAdapterTrail with zero error diagnostics", async () => {
  const trail = await parseReasoningFixture();
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("reasoning-and-interrupt fixture emits agent_thinking, agent_message, and synthesized user_interrupt", async () => {
  const trail = await parseReasoningFixture();
  const types = trail.groups[0]!.entries.map((e) => e.type);
  expect(types).toContain("agent_thinking");
  expect(types).toContain("user_interrupt");
  const interrupt = trail.groups[0]!.entries.find((e) => e.type === "user_interrupt");
  expect(interrupt?.source?.synthesized).toBe(true);
  const redacted = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "agent_thinking" &&
      (e.payload as { text?: string }).text === "[redacted thinking]",
  );
  expect(redacted).toBeDefined();
});

// Fixture-driven: compaction-and-model-change.jsonl validates end-to-end and covers both events
test("compaction-and-model-change fixture round-trips through validateAdapterTrail with zero error diagnostics", async () => {
  const trail = await parseCompactFixture();
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("compaction-and-model-change fixture emits context_compact and model_change with from_model from prior assistant", async () => {
  const trail = await parseCompactFixture();
  const entries = trail.groups[0]!.entries;
  const compact = entries.find((e) => e.type === "context_compact");
  const foldedUser = entries.find(
    (e) => e.type === "user_message" && (e.payload as { text?: string }).text === "long ramble",
  );
  expect(compact).toBeDefined();
  expect(foldedUser).toBeDefined();
  expect((compact?.payload as { summary?: string }).summary).toContain("acknowledged");
  expect((compact?.payload as { trigger?: string }).trigger).toBe("auto");
  expect((compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids).toEqual([
    foldedUser!.id,
  ]);
  const mc = entries.find((e) => e.type === "model_change");
  expect(mc?.payload).toEqual({
    from_model: "claude-sonnet-4-5",
    to_model: "claude-opus-4-7",
  });
});

test("compaction provenance includes quarantined entries before firstKeptEntryId", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pi-compact-quarantine-"));
  const path = join(tmp, "session.jsonl");
  try {
    const lines = [
      {
        type: "session",
        version: 3,
        id: "00000000-0000-0000-0000-000000176101",
        timestamp: "2026-06-01T02:00:00.000Z",
        cwd: "/tmp/synthetic-project",
      },
      {
        type: "message",
        id: "00000000-0000-0000-0000-000000176102",
        parentId: null,
        timestamp: "2026-06-01T02:00:01.000Z",
        message: { role: "user", content: "long prompt" },
      },
      {
        type: "plugin_blob",
        id: "00000000-0000-0000-0000-000000176103",
        parentId: "00000000-0000-0000-0000-000000176102",
        timestamp: "2026-06-01T02:00:02.000Z",
        blob: { opaque: "data" },
      },
      {
        type: "message",
        id: "00000000-0000-0000-0000-000000176104",
        parentId: "00000000-0000-0000-0000-000000176103",
        timestamp: "2026-06-01T02:00:03.000Z",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          stopReason: "stop",
          content: [{ type: "text", text: "kept answer" }],
        },
      },
      {
        type: "compaction",
        id: "00000000-0000-0000-0000-000000176105",
        parentId: "00000000-0000-0000-0000-000000176104",
        timestamp: "2026-06-01T02:00:04.000Z",
        summary: "Compacted prompt and plugin blob.",
        firstKeptEntryId: "00000000-0000-0000-0000-000000176104",
      },
    ];
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const trail = await piAdapter.parseSession({
      id: "00000000-0000-0000-0000-000000176101",
      adapter: "pi",
      path,
    });

    const entries = trail.groups[0]!.entries;
    const compact = entries.find((e) => e.type === "context_compact");
    const user = entries.find((e) => e.type === "user_message");
    const quarantine = entries.find(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "x-pi/unknown_record",
    );
    if (user === undefined) throw new Error("expected folded user entry");
    if (quarantine === undefined) throw new Error("expected folded quarantine entry");
    expect((compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids).toEqual([
      user.id,
      quarantine.id,
    ]);
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("compaction omits replaced_message_ids when firstKeptEntryId does not resolve", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pi-compact-unresolved-"));
  const path = join(tmp, "session.jsonl");
  try {
    const lines = [
      {
        type: "session",
        version: 3,
        id: "00000000-0000-0000-0000-000000176001",
        timestamp: "2026-06-01T02:00:00.000Z",
        cwd: "/tmp/synthetic-project",
      },
      {
        type: "message",
        id: "00000000-0000-0000-0000-000000176002",
        parentId: null,
        timestamp: "2026-06-01T02:00:01.000Z",
        message: { role: "user", content: "long prompt" },
      },
      {
        type: "compaction",
        id: "00000000-0000-0000-0000-000000176003",
        parentId: "00000000-0000-0000-0000-000000176002",
        timestamp: "2026-06-01T02:00:02.000Z",
        summary: "Compacted prompt.",
        firstKeptEntryId: "00000000-0000-0000-0000-000000176999",
      },
    ];
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const trail = await piAdapter.parseSession({
      id: "00000000-0000-0000-0000-000000176001",
      adapter: "pi",
      path,
    });
    const compact = trail.groups[0]!.entries.find((e) => e.type === "context_compact");
    expect(
      (compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids,
    ).toBeUndefined();
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("parseSession() does not populate vcs from live git state at header.cwd", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "pi-vcs-repo-"));
  try {
    async function git(args: string[]): Promise<void> {
      const proc = Bun.spawn(["git", ...args], {
        cwd: repoDir,
        env: cleanGitEnv(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}`);
    }
    await git(["init", "-q"]);
    await git([
      "-c",
      "user.email=a@b",
      "-c",
      "user.name=Tester",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ]);
    await git(["remote", "add", "origin", "git@github.com:agent-trail/agent-trail.git"]);

    const session = {
      type: "session",
      version: 3,
      id: "00000000-0000-0000-0000-d284b8ccaa98",
      timestamp: "2026-05-21T14:00:00.000Z",
      cwd: repoDir,
    };
    const fixturePath = join(repoDir, "session.jsonl");
    writeFileSync(fixturePath, `${JSON.stringify(session)}\n`);

    const trail = await piAdapter.parseSession({
      id: "00000000-0000-0000-0000-d284b8ccaa98",
      adapter: "pi",
      path: fixturePath,
    });
    expect(trail.groups[0]!.header.vcs).toBeUndefined();
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("parseSession() leaves vcs undefined when cwd is not a git working tree", async () => {
  const trail = await parseFixture();
  expect(trail.groups[0]!.header.vcs).toBeUndefined();
});

test("session_info emits session_metadata_update name instead of x-pi/session_info", async () => {
  const trail = await parseSystemEventsFixture();
  const update = trail.groups[0]!.entries.find(
    (e) => e.type === "session_metadata_update" && e.payload?.field === "name",
  );
  expect(update?.payload).toEqual({
    field: "name",
    value: "Refactor adapter kit",
    reason: "ai_generated",
  });
  expect(
    trail.groups[0]!.entries.some(
      (e) =>
        e.type === "system_event" && (e.payload as { kind?: unknown }).kind === "x-pi/session_info",
    ),
  ).toBe(false);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("thinking_level_change emits first-class event instead of x-pi/thinking_level_change", async () => {
  const trail = await parseSystemEventsFixture();
  const change = trail.groups[0]!.entries.find((e) => e.type === "thinking_level_change");
  expect(change?.payload).toEqual({
    to_level: "high",
    trigger: "runtime_inferred",
  });
  expect(
    trail.groups[0]!.entries.some(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: unknown }).kind === "x-pi/thinking_level_change",
    ),
  ).toBe(false);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("thinking_level_change without thinkingLevel is dropped instead of inventing a level", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "pi-thinking-level-"));
  try {
    const fixturePath = join(tmp, "session.jsonl");
    const lines = [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "00000000-0000-0000-0000-ffff00000010",
        timestamp: "2026-05-21T19:00:00.000Z",
        cwd: "/tmp/synthetic-project",
      }),
      JSON.stringify({
        type: "thinking_level_change",
        id: "00000000-0000-0000-0000-ffff00000011",
        parentId: null,
        timestamp: "2026-05-21T19:00:01.000Z",
      }),
    ].join("\n");
    writeFileSync(fixturePath, `${lines}\n`);
    const trail = await piAdapter.parseSession({
      id: "missing-thinking-level",
      adapter: "pi",
      path: fixturePath,
    });
    expect(trail.groups[0]!.entries.filter((e) => e.type === "thinking_level_change")).toEqual([]);
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Issue #88: Pi `custom` / `custom_message` are the plugin extension surface.
// Adapter collapses every plugin-defined customType into one vendor kind per
// envelope-type and preserves the source customType under payload.data.custom_type.
// Issue #88: custom_message without `content` must still produce a non-empty
// text — the synthesized fallback uses customType so the timeline never carries
// a payload with an empty text field.

// Issue #125 #1/#2: LeafEntry and LabelEntry are now in the pi/v1 source-schema
// enum, so they route to typed mappings (x-pi/leaf_change, x-pi/label) instead of
// generic x-pi/unknown_record quarantine. piParentResolution resolves the raw Pi
// target ids to mapped entry ids.
async function parseLeafLabelFixture() {
  return piAdapter.parseSession({
    id: "leaf-and-label",
    adapter: "pi",
    path: LEAF_AND_LABEL_FIXTURE_PATH,
  });
}

test("LeafEntry maps to x-pi/leaf_change with data.leaf_id resolved to the target entry id", async () => {
  const trail = await parseLeafLabelFixture();
  const entries = trail.groups[0]!.entries;
  const assistant = entries.find((e) => e.type === "agent_message");
  const leaf = entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/leaf_change",
  );
  expect(leaf).toBeDefined();
  expect((leaf?.payload as { data?: { leaf_id?: string } }).data?.leaf_id).toBe(assistant?.id);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("LabelEntry maps to x-pi/label with data.target_id resolved and label preserved", async () => {
  const trail = await parseLeafLabelFixture();
  const entries = trail.groups[0]!.entries;
  const user = entries.find((e) => e.type === "user_message");
  const label = entries.find(
    (e) => e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/label",
  );
  expect((label?.payload as { data?: { target_id?: string; label?: string } }).data).toEqual({
    target_id: user?.id,
    label: "important",
  });
});

// Issue #125 #3: BashExecutionMessage (user `!`/`!!` shell prefix) maps to a
// shell_command tool_call + tool_result pair, with user origin and the bash-only
// fields recorded in dev.pi.* meta (truncated stays out of payload because the
// spec requires output_size alongside it, which Pi does not provide).
async function parseBashFixture() {
  return piAdapter.parseSession({
    id: "bash-execution",
    adapter: "pi",
    path: BASH_EXECUTION_FIXTURE_PATH,
  });
}

test("BashExecutionMessage maps to a user-origin shell_command tool_call + tool_result pair", async () => {
  const trail = await parseBashFixture();
  const entries = trail.groups[0]!.entries;
  const calls = entries.filter((e) => e.type === "tool_call");
  const results = entries.filter((e) => e.type === "tool_result");
  const aborts = entries.filter((e) => e.type === "tool_call_aborted");
  expect(calls).toHaveLength(2);
  expect(results).toHaveLength(1);
  expect(aborts).toHaveLength(1);

  const okCall = calls[0]!;
  expect((okCall.payload as { tool?: string; args?: { command?: string } }).tool).toBe(
    "shell_command",
  );
  expect((okCall.payload as { args?: { command?: string } }).args?.command).toBe("ls -1");
  expect((okCall.meta as Record<string, unknown>)["dev.pi.user_shell"]).toBe(true);
  const okResult = results.find((r) => (r.payload as { for_id?: string }).for_id === okCall.id);
  expect((okResult?.payload as { ok?: boolean }).ok).toBe(true);
  expect(
    (okResult?.payload as { meta?: { shell_command?: { exit_code?: number } } }).meta?.shell_command
      ?.exit_code,
  ).toBe(0);

  const cancelledAbort = aborts[0];
  const cancelledAbortForId = (cancelledAbort?.payload as { for_id?: string } | undefined)?.for_id;
  expect(typeof cancelledAbortForId).toBe("string");
  expect(cancelledAbort?.payload).toEqual({
    scope: "tool_call",
    reason: "user_interrupt",
    for_id: cancelledAbortForId as string,
  });
  const cancelledMeta = cancelledAbort?.meta as Record<string, unknown>;
  expect(cancelledMeta["dev.pi.truncated"]).toBe(true);
  expect(cancelledMeta["dev.pi.full_output_path"]).toBe("/tmp/full-output.txt");
  const cancelledCall = calls.find(
    (c) => c.id === (cancelledAbort?.payload as { for_id?: string }).for_id,
  );
  expect((cancelledCall?.meta as Record<string, unknown>)["dev.pi.exclude_from_context"]).toBe(
    true,
  );
  expect(entries.some((e) => e.type === "session_terminated")).toBe(false);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

// Issue #125 #4: message-channel variants (role:"branchSummary"/"compactionSummary"/
// "custom") route to the same trail entries as their tree-entry counterparts.
async function parseCustomVariantsFixture() {
  return piAdapter.parseSession({
    id: "custom-message-variants",
    adapter: "pi",
    path: CUSTOM_VARIANTS_FIXTURE_PATH,
  });
}

test("message-channel branchSummary/compactionSummary/custom route to their entry types", async () => {
  const trail = await parseCustomVariantsFixture();
  const entries = trail.groups[0]!.entries;

  const branch = entries.find((e) => e.type === "branch_summary");
  expect((branch?.payload as { summary?: string }).summary).toBe("Explored X, switching to Y.");

  const compact = entries.find((e) => e.type === "context_compact");
  expect((compact?.payload as { summary?: string; tokens_before?: number }).tokens_before).toBe(
    12000,
  );

  const custom = entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/custom_message",
  );
  expect((custom?.payload as { data?: { custom_type?: string } }).data?.custom_type).toBe("note");
  // #12: display:false surfaces in meta without dropping the event.
  expect((custom?.meta as Record<string, unknown>)["dev.pi.display"]).toBe(false);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("interactive-shell-transfer custom_message emits a dedicated Pi system_event", async () => {
  const dir = createProjectDir();
  const file = join(dir, "interactive-shell-transfer.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-1e5000000001", timestamp: "2026-05-22T03:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify(
      {
        type: "custom_message",
        customType: "interactive-shell-transfer",
        content: "Session review was killed (17s). 40 lines of output.",
        display: true,
        details: {
          sessionId: "review",
          duration: "17s",
          exitCode: null,
          timedOut: false,
          cancelled: true,
          completionOutput: {
            lines: ["line 1", "line 2"],
            totalLines: 40,
            truncated: true,
          },
        },
        id: "00000000-0000-0000-0000-1e5000000002",
        parentId: null,
        timestamp: "2026-05-22T03:00:01.000Z",
      },
    )}\n`,
  );
  const trail = await piAdapter.parseSession({
    id: "interactive-shell-transfer",
    adapter: "pi",
    path: file,
  });
  const entry = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind?: string }).kind === "x-pi/interactive_shell_transfer",
  );
  expect(entry?.payload).toEqual({
    kind: "x-pi/interactive_shell_transfer",
    text: "Session review was killed (17s). 40 lines of output.",
    data: {
      custom_type: "interactive-shell-transfer",
      session_id: "review",
      duration: "17s",
      exit_code: null,
      timed_out: false,
      cancelled: true,
      output_total_lines: 40,
      output_truncated: true,
      output_line_count: 2,
    },
  });
  expect((entry?.meta as Record<string, unknown>)["dev.pi.display"]).toBe(true);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

// Issue #125 #14: PiMessage.toolName surfaces in tool_result meta.
test("tool_result surfaces the source toolName in dev.pi.tool_name", async () => {
  const dir = createProjectDir();
  const file = join(dir, "toolname.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-700100000001", timestamp: "2026-05-21T23:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-700100000002", parentId: null, timestamp: "2026-05-21T23:00:01.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "x" } }] } })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-700100000003", parentId: "00000000-0000-0000-0000-700100000002", timestamp: "2026-05-21T23:00:02.000Z", message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: "ok" } })}\n`,
  );
  const trail = await piAdapter.parseSession({ id: "toolname", adapter: "pi", path: file });
  const result = trail.groups[0]!.entries.find((e) => e.type === "tool_result");
  expect((result?.meta as Record<string, unknown>)["dev.pi.tool_name"]).toBe("read");
});

// Issue #125 #5: BranchSummaryEntry.fromHook surfaces in dev.pi.branch_from_hook
// (distinguishes a hook-triggered branch return from a user one).
test("branch_summary entry surfaces fromHook in dev.pi.branch_from_hook", async () => {
  const dir = createProjectDir();
  const file = join(dir, "branch-fromhook.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-b00100000001", timestamp: "2026-05-22T00:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-b00100000002", parentId: null, timestamp: "2026-05-22T00:00:01.000Z", message: { role: "user", content: "start" } })}\n${JSON.stringify({ type: "branch_summary", id: "00000000-0000-0000-0000-b00100000003", parentId: "00000000-0000-0000-0000-b00100000002", timestamp: "2026-05-22T00:00:02.000Z", fromId: "00000000-0000-0000-0000-b00100000002", summary: "hook-driven return", fromHook: true })}\n`,
  );
  const trail = await piAdapter.parseSession({ id: "branch-fromhook", adapter: "pi", path: file });
  const branch = trail.groups[0]!.entries.find((e) => e.type === "branch_summary");
  expect((branch?.meta as Record<string, unknown>)["dev.pi.branch_from_hook"]).toBe(true);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

// Issue #125 #1: LeafEntry.targetId is `string | null`; a null tip clears the
// active pointer — emit x-pi/leaf_change with no data.leaf_id.
test("LeafEntry with null targetId emits x-pi/leaf_change without data", async () => {
  const dir = createProjectDir();
  const file = join(dir, "leaf-null.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-1ea000000001", timestamp: "2026-05-22T01:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-1ea000000002", parentId: null, timestamp: "2026-05-22T01:00:01.000Z", message: { role: "user", content: "start" } })}\n${JSON.stringify({ type: "leaf", id: "00000000-0000-0000-0000-1ea000000003", parentId: "00000000-0000-0000-0000-1ea000000002", timestamp: "2026-05-22T01:00:02.000Z", targetId: null })}\n`,
  );
  const trail = await piAdapter.parseSession({ id: "leaf-null", adapter: "pi", path: file });
  const leaf = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/leaf_change",
  );
  expect(leaf).toBeDefined();
  expect((leaf?.payload as { data?: unknown }).data).toBeUndefined();
  expect((leaf?.payload as { text?: string }).text).toBe("Active branch tip cleared");
});

// Issue #125 #2: LabelEntry.label is optional; a label-less annotation still
// emits x-pi/label with the resolved target_id and no label key.
test("LabelEntry with no label emits x-pi/label with target_id only", async () => {
  const dir = createProjectDir();
  const file = join(dir, "label-bare.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-1ab000000001", timestamp: "2026-05-22T02:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-1ab000000002", parentId: null, timestamp: "2026-05-22T02:00:01.000Z", message: { role: "user", content: "start" } })}\n${JSON.stringify({ type: "label", id: "00000000-0000-0000-0000-1ab000000003", parentId: "00000000-0000-0000-0000-1ab000000002", timestamp: "2026-05-22T02:00:02.000Z", targetId: "00000000-0000-0000-0000-1ab000000002" })}\n`,
  );
  const trail = await piAdapter.parseSession({ id: "label-bare", adapter: "pi", path: file });
  const entries = trail.groups[0]!.entries;
  const user = entries.find((e) => e.type === "user_message");
  const label = entries.find(
    (e) => e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/label",
  );
  expect((label?.payload as { data?: { target_id?: string; label?: string } }).data).toEqual({
    target_id: user?.id,
  });
  expect((label?.payload as { text?: string }).text).toBe("Label");
});

// Issue #125 #12: display surfaces for the custom_message *entry* form (not only
// the message-channel variant).
test("custom_message entry surfaces display:false in dev.pi.display", async () => {
  const dir = createProjectDir();
  const file = join(dir, "custom-display.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-d15000000001", timestamp: "2026-05-22T03:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "custom_message", id: "00000000-0000-0000-0000-d15000000002", parentId: null, timestamp: "2026-05-22T03:00:01.000Z", customType: "note", content: "hidden note", display: false })}\n`,
  );
  const trail = await piAdapter.parseSession({ id: "custom-display", adapter: "pi", path: file });
  const custom = trail.groups[0]!.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/custom_message",
  );
  expect((custom?.meta as Record<string, unknown>)["dev.pi.display"]).toBe(false);
});

// Issue #125 #1: the explicit LeafEntry tip feeds branch_summary resolution.
// fromId points to an abandoned sibling; with the active leaf at the assistant,
// the divergence walk resolves abandoned_branch_id to the abandoned child.
test("explicit leaf feeds branch_summary.abandoned_branch_id resolution", async () => {
  const dir = createProjectDir();
  const file = join(dir, "leaf-branch.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-1eafb0000001", timestamp: "2026-05-22T04:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-1eafb0000002", parentId: null, timestamp: "2026-05-22T04:00:01.000Z", message: { role: "user", content: "root" } })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-1eafb0000003", parentId: "00000000-0000-0000-0000-1eafb0000002", timestamp: "2026-05-22T04:00:02.000Z", message: { role: "assistant", model: "claude-sonnet-4-5", stopReason: "stop", content: "active path" } })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-1eafb0000004", parentId: "00000000-0000-0000-0000-1eafb0000002", timestamp: "2026-05-22T04:00:03.000Z", message: { role: "user", content: "abandoned branch" } })}\n${JSON.stringify({ type: "leaf", id: "00000000-0000-0000-0000-1eafb0000005", parentId: "00000000-0000-0000-0000-1eafb0000003", timestamp: "2026-05-22T04:00:04.000Z", targetId: "00000000-0000-0000-0000-1eafb0000003" })}\n${JSON.stringify({ type: "branch_summary", id: "00000000-0000-0000-0000-1eafb0000006", parentId: "00000000-0000-0000-0000-1eafb0000003", timestamp: "2026-05-22T04:00:05.000Z", fromId: "00000000-0000-0000-0000-1eafb0000004", summary: "came back from the abandoned branch" })}\n`,
  );
  const trail = await piAdapter.parseSession({ id: "leaf-branch", adapter: "pi", path: file });
  const entries = trail.groups[0]!.entries;
  const leaf = entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/leaf_change",
  );
  const assistant = entries.find((e) => e.type === "agent_message");
  // leaf resolves to the active assistant entry id.
  expect((leaf?.payload as { data?: { leaf_id?: string } }).data?.leaf_id).toBe(assistant?.id);
  // abandoned_branch_id resolves to the abandoned sibling (the second user_message).
  const branch = entries.find((e) => e.type === "branch_summary");
  const abandoned = entries.find(
    (e) => e.id === (branch?.payload as { abandoned_branch_id?: string }).abandoned_branch_id,
  );
  expect(abandoned?.type).toBe("user_message");
  expect((abandoned?.payload as { text?: string }).text).toBe("abandoned branch");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

// Issue #125 #1/#2: when a leaf/label targetId points at a source id that emitted
// no entry, resolution climbs to the nearest mapped ancestor (mirrors
// abandoned_branch_id). A target with no mapped ancestor keeps the raw id.
test("label target resolves to nearest mapped ancestor when the target emitted nothing", async () => {
  const dir = createProjectDir();
  const file = join(dir, "label-ancestor.jsonl");
  // The compaction has no summary → emits nothing; the label targets it, so
  // resolution must climb to the user_message parent.
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-1abc00000001", timestamp: "2026-05-22T05:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-1abc00000002", parentId: null, timestamp: "2026-05-22T05:00:01.000Z", message: { role: "user", content: "start" } })}\n${JSON.stringify({ type: "compaction", id: "00000000-0000-0000-0000-1abc00000003", parentId: "00000000-0000-0000-0000-1abc00000002", timestamp: "2026-05-22T05:00:02.000Z" })}\n${JSON.stringify({ type: "label", id: "00000000-0000-0000-0000-1abc00000004", parentId: "00000000-0000-0000-0000-1abc00000002", timestamp: "2026-05-22T05:00:03.000Z", targetId: "00000000-0000-0000-0000-1abc00000003", label: "tag" })}\n`,
  );
  const trail = await piAdapter.parseSession({ id: "label-ancestor", adapter: "pi", path: file });
  const entries = trail.groups[0]!.entries;
  const user = entries.find((e) => e.type === "user_message");
  const label = entries.find(
    (e) => e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/label",
  );
  expect((label?.payload as { data?: { target_id?: string } }).data?.target_id).toBe(user?.id);
});

test("label target with no mapped ancestor keeps the raw Pi id", async () => {
  const dir = createProjectDir();
  const file = join(dir, "label-unresolved.jsonl");
  // targetId references an id that appears nowhere → no mapped ancestor exists.
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-1abd00000001", timestamp: "2026-05-22T06:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-1abd00000002", parentId: null, timestamp: "2026-05-22T06:00:01.000Z", message: { role: "user", content: "start" } })}\n${JSON.stringify({ type: "label", id: "00000000-0000-0000-0000-1abd00000003", parentId: "00000000-0000-0000-0000-1abd00000002", timestamp: "2026-05-22T06:00:02.000Z", targetId: "00000000-0000-0000-0000-deadbeef0000", label: "dangling" })}\n`,
  );
  const trail = await piAdapter.parseSession({ id: "label-unresolved", adapter: "pi", path: file });
  const label = trail.groups[0]!.entries.find(
    (e) => e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/label",
  );
  expect((label?.payload as { data?: { target_id?: string } }).data?.target_id).toBe(
    "00000000-0000-0000-0000-deadbeef0000",
  );
});

// Issue #125 #1: a cleared leaf (targetId:null) resets the tracked active tip so
// a following branch_summary falls back to its own parent rather than a stale
// leaf. Exercises the reset branch + fallback.
test("a cleared leaf resets the active tip before a later branch_summary", async () => {
  const dir = createProjectDir();
  const file = join(dir, "leaf-clear-branch.jsonl");
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: "00000000-0000-0000-0000-c1ea00000001", timestamp: "2026-05-22T07:00:00.000Z", cwd: "/tmp/synthetic-project" })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-c1ea00000002", parentId: null, timestamp: "2026-05-22T07:00:01.000Z", message: { role: "user", content: "root" } })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-c1ea00000003", parentId: "00000000-0000-0000-0000-c1ea00000002", timestamp: "2026-05-22T07:00:02.000Z", message: { role: "assistant", model: "claude-sonnet-4-5", stopReason: "stop", content: "active" } })}\n${JSON.stringify({ type: "leaf", id: "00000000-0000-0000-0000-c1ea00000004", parentId: "00000000-0000-0000-0000-c1ea00000003", timestamp: "2026-05-22T07:00:03.000Z", targetId: "00000000-0000-0000-0000-c1ea00000003" })}\n${JSON.stringify({ type: "leaf", id: "00000000-0000-0000-0000-c1ea00000005", parentId: "00000000-0000-0000-0000-c1ea00000003", timestamp: "2026-05-22T07:00:04.000Z", targetId: null })}\n${JSON.stringify({ type: "message", id: "00000000-0000-0000-0000-c1ea00000006", parentId: "00000000-0000-0000-0000-c1ea00000002", timestamp: "2026-05-22T07:00:05.000Z", message: { role: "user", content: "abandoned" } })}\n${JSON.stringify({ type: "branch_summary", id: "00000000-0000-0000-0000-c1ea00000007", parentId: "00000000-0000-0000-0000-c1ea00000003", timestamp: "2026-05-22T07:00:06.000Z", fromId: "00000000-0000-0000-0000-c1ea00000006", summary: "back from abandoned" })}\n`,
  );
  const trail = await piAdapter.parseSession({
    id: "leaf-clear-branch",
    adapter: "pi",
    path: file,
  });
  const entries = trail.groups[0]!.entries;
  const leafChanges = entries.filter(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/leaf_change",
  );
  expect(leafChanges).toHaveLength(2);
  // The clearing leaf carries no data.leaf_id.
  expect((leafChanges[1]?.payload as { data?: unknown }).data).toBeUndefined();
  // branch_summary still resolves to the abandoned sibling via the parent fallback.
  const branch = entries.find((e) => e.type === "branch_summary");
  const abandoned = entries.find(
    (e) => e.id === (branch?.payload as { abandoned_branch_id?: string }).abandoned_branch_id,
  );
  expect((abandoned?.payload as { text?: string }).text).toBe("abandoned");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});
