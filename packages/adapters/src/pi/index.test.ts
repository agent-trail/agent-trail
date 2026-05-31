import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piAdapter, validateAdapterTrail } from "../index.ts";
// Adapter surface tests assert on the shape returned by parseSession. Entry ids
// are an internal detail of the kit engine, so tests locate entries by type and
// content and assert linkage via the found entries' own ids — never by a
// reconstructed id.
import { mangleCwd, piAgentDir, piProjectDir, piSessionsDir } from "./paths.ts";
import { toolKindAndArgs } from "./tools.ts";

const ID_PATTERN =
  /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/;

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
const QUARANTINE_FIXTURE_PATH = new URL("../../tests/fixtures/pi/quarantine.jsonl", import.meta.url)
  .pathname;

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

async function parseQuarantineFixture() {
  return piAdapter.parseSession({
    id: "quarantine",
    adapter: "pi",
    path: QUARANTINE_FIXTURE_PATH,
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
  expect(trail.envelope?.id).not.toBe(trail.header.id);
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
  const { session_uid, ...header } = trail.header;
  expect(typeof session_uid).toBe("string");
  expect(session_uid).toMatch(
    /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/,
  );
  // session_uid is deterministic — re-parsing the same source yields the same uid.
  const reparsed = await parseFixture();
  expect(reparsed.header.session_uid).toBe(session_uid);
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
  });
});

// TDD step 3: user_message mapping
test("parseSession() emits a user_message for user role records with no parent_id when parentId is null", async () => {
  const trail = await parseFixture();
  const userMessage = trail.entries.find((e) => e.type === "user_message");
  expect(userMessage).toBeDefined();
  expect(userMessage?.ts).toBe("2026-05-21T14:00:01.000Z");
  expect(userMessage?.payload).toEqual({ text: "please read spec.md" });
  expect(userMessage?.parent_id).toBeUndefined();
  expect(userMessage?.source?.original_type).toBe("message");
});

// TDD step 4: agent_message text mapping
test("parseSession() emits an agent_message for assistant text blocks with model and stop_reason", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.entries.find((e) => e.type === "agent_message");
  const toolResult = trail.entries.find((e) => e.type === "tool_result");
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
  const agentMsg = trail.entries.find((e) => e.type === "agent_message");
  expect(agentMsg?.type).toBe("agent_message");
  expect((agentMsg?.payload as Record<string, unknown>)?.usage).toEqual({
    input_tokens: 1234,
    output_tokens: 567,
    input_tokens_cumulative: 12340,
    output_tokens_cumulative: 5670,
    cache_read_tokens: 100,
    cache_creation_tokens: 50,
    reasoning_tokens: 200,
  });
});

test("parseSession() omits payload.usage on agent_message when Pi envelope has no usage", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.entries.find((e) => e.type === "agent_message");
  expect(agentMsg?.payload).not.toHaveProperty("usage");
});

// TDD step 5: tool_call mapping (read -> file_read)
test("parseSession() emits a tool_call for assistant toolCall blocks with semantic.call_id preserving toolCall.id", async () => {
  const trail = await parseFixture();
  const toolCall = trail.entries.find((e) => e.type === "tool_call");
  const userMessage = trail.entries.find((e) => e.type === "user_message");
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
  const toolResult = trail.entries.find((e) => e.type === "tool_result");
  const toolCall = trail.entries.find((e) => e.type === "tool_call");
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
  expect(trail.entries.map((e) => e.type)).toEqual([
    "user_message",
    "tool_call",
    "tool_result",
    "agent_message",
  ]);
});

test("parseSession() emits v0.1-shaped deterministic entry ids across representative fixtures", async () => {
  const first = await parseFixture();
  const second = await parseFixture();
  expect(first.entries.map((e) => e.id)).toEqual(second.entries.map((e) => e.id));
  for (const entry of first.entries) expect(entry.id).toMatch(ID_PATTERN);

  const stateful = await parseReasoningFixture();
  const statefulAgain = await parseReasoningFixture();
  expect(stateful.entries.map((e) => e.id)).toEqual(statefulAgain.entries.map((e) => e.id));
  for (const entry of stateful.entries) expect(entry.id).toMatch(ID_PATTERN);
  expect(stateful.entries.some((e) => e.type === "user_interrupt")).toBe(true);
  expect(stateful.entries.some((e) => e.type === "session_terminated")).toBe(true);
});

test("every entry carries source metadata: agent='pi', original_type set, schema_version stringified, raw preserved", async () => {
  const trail = await parseFixture();
  for (const entry of trail.entries) {
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
  const quarantine = trail.entries.find(
    (e) =>
      e.type === "system_event" && (e.payload as { kind?: string }).kind === "x-pi/unknown_record",
  );
  expect(quarantine?.ts).toBe("2026-05-21T14:00:00.000Z");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() preserves Pi tree parenting through quarantined source records", async () => {
  const trail = await parseQuarantineFixture();
  expect(trail.entries.map((e) => e.type)).toEqual([
    "user_message",
    "system_event",
    "agent_message",
  ]);

  const user = trail.entries[0];
  const quarantine = trail.entries[1];
  const agent = trail.entries[2];

  expect(user?.parent_id).toBeUndefined();
  expect((quarantine?.payload as { kind?: string }).kind).toBe("x-pi/unknown_record");
  expect(quarantine?.parent_id).toBe(user?.id);
  expect(agent?.parent_id).toBe(user?.id);

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
  expect(trail.entries.map((e) => e.type)).toEqual(["user_message", "agent_message"]);
  const user = trail.entries[0];
  const agent = trail.entries[1];
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

test("toolKindAndArgs falls back to 'other' for Pi 'edit' multi across multiple files (no canonical single-file representation)", () => {
  const result = toolKindAndArgs("edit", {
    multi: [
      { path: "a.md", oldText: "foo", newText: "bar" },
      { path: "b.md", oldText: "baz", newText: "qux" },
    ],
  });
  expect(result.tool).toBe("other");
});

test("toolKindAndArgs falls back to 'other' for Pi 'edit' apply_patch shape (non-unified diff)", () => {
  const result = toolKindAndArgs("edit", {
    patch: "*** Begin Patch\n*** Update File: x.md\n@@\n-a\n+b\n*** End Patch",
  });
  expect(result.tool).toBe("other");
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

test("toolKindAndArgs maps Pi 'ls' -> shell_command with synthesized 'ls -- <path>' command", () => {
  expect(toolKindAndArgs("ls", { path: "src" })).toEqual({
    tool: "shell_command",
    args: { command: "ls -- src" },
  });
  expect(toolKindAndArgs("ls", {})).toEqual({
    tool: "shell_command",
    args: { command: "ls" },
  });
  expect(toolKindAndArgs("ls", { path: "dir with space" })).toEqual({
    tool: "shell_command",
    args: { command: "ls -- 'dir with space'" },
  });
});

test("toolKindAndArgs guards 'ls' against paths beginning with '-' via POSIX option terminator", () => {
  // Without `--`, `ls -rf` would be parsed as flags and might recurse/force-fail
  // instead of listing the literal directory `-rf`.
  expect(toolKindAndArgs("ls", { path: "-rf" })).toEqual({
    tool: "shell_command",
    args: { command: "ls -- -rf" },
  });
});

test("toolKindAndArgs falls back to 'other' for non-built-in tool names (e.g., MCP extensions)", () => {
  expect(toolKindAndArgs("custom_mcp_tool", { foo: "bar" })).toEqual({
    tool: "other",
    args: { name: "custom_mcp_tool", args: { foo: "bar" } },
  });
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
  const byParent = new Map<string, typeof trail.entries>();
  for (const e of trail.entries) {
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
  const branchSummary = trail.entries.find((e) => e.type === "branch_summary");
  expect(branchSummary).toBeDefined();
  expect((branchSummary?.payload as { summary?: string }).summary).toBe(
    "Explored X, switching to Y.",
  );
});

// TDD step 4: branch_summary entry's parent_id is the fork point (pi-a1), same as the user messages.
test("branch-flow branch_summary entry has parent_id resolved to the fork point (pi-a1)", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.entries.find((e) => e.type === "branch_summary");
  // The fork point is the parent shared by the two user_message children.
  const byParent = new Map<string, typeof trail.entries>();
  for (const e of trail.entries) {
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
  const branchSummary = trail.entries.find((e) => e.type === "branch_summary");
  const payload = branchSummary?.payload as { abandoned_branch_id?: string };
  const abandoned = trail.entries.find((e) => e.id === payload.abandoned_branch_id);
  expect(abandoned).toBeDefined();
  expect(abandoned?.type).toBe("user_message");
  // It is one of the two forked children (the abandoned side, not the active path).
  expect(abandoned?.parent_id).toBe(branchSummary?.parent_id);
});

// TDD step 6: source.raw preserves the original Pi envelope (fromId, summary, details)
test("branch-flow branch_summary entry preserves the original envelope under source.raw", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.entries.find((e) => e.type === "branch_summary");
  const raw = branchSummary?.source?.raw as Record<string, unknown>;
  expect(raw?.type).toBe("branch_summary");
  expect(raw?.fromId).toBe("00000000-0000-0000-0000-bbbbbbbb0002");
  expect(raw?.summary).toBe("Explored X, switching to Y.");
  expect(raw?.details).toEqual({ readFiles: ["spec.md"], modifiedFiles: ["x.md"] });
});

// TDD step 7: Pi branch_summary.details surface in entry.meta under reverse-domain key (spec §8.0.3 / §11)
test("branch-flow branch_summary entry mirrors Pi details into meta['dev.pi.branch_details']", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.entries.find((e) => e.type === "branch_summary");
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
  const types = trail.entries.map((e) => e.type);
  expect(types).toContain("agent_thinking");
  expect(types).toContain("user_interrupt");
  const interrupt = trail.entries.find((e) => e.type === "user_interrupt");
  expect(interrupt?.source?.synthesized).toBe(true);
  const redacted = trail.entries.find(
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
  const compact = trail.entries.find((e) => e.type === "context_compact");
  expect(compact).toBeDefined();
  expect((compact?.payload as { summary?: string }).summary).toContain("acknowledged");
  expect((compact?.payload as { trigger?: string }).trigger).toBe("auto");
  const mc = trail.entries.find((e) => e.type === "model_change");
  expect(mc?.payload).toEqual({
    from_model: "claude-sonnet-4-5",
    to_model: "claude-opus-4-7",
  });
});

test("parseSession() populates vcs.remote_url from header.cwd when cwd is a git working tree with an origin remote", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "pi-vcs-repo-"));
  try {
    async function git(args: string[]): Promise<void> {
      const proc = Bun.spawn(["git", ...args], { cwd: repoDir, stdout: "pipe", stderr: "pipe" });
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
    expect(trail.header.vcs).toBeDefined();
    expect(trail.header.vcs?.type).toBe("git");
    expect(trail.header.vcs?.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(trail.header.vcs?.remote_url).toBe("https://github.com/agent-trail/agent-trail");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("parseSession() leaves vcs undefined when cwd is not a git working tree", async () => {
  const trail = await parseFixture();
  expect(trail.header.vcs).toBeUndefined();
});

// Issue #88: Pi `thinking_level_change` is a built-in pi-mono envelope. It maps
// to x-pi/thinking_level_change because no reserved kind covers thinking-level
// transitions (model_change is for model id only).
// Issue #88: Pi `session_info` is the built-in session-namer hook. Surface as
// x-pi/session_info (vendor; no portable equivalent yet).
// Issue #88: Pi `custom` / `custom_message` are the plugin extension surface.
// Adapter collapses every plugin-defined customType into one vendor kind per
// envelope-type and preserves the source customType under payload.data.custom_type.
// Issue #88: custom_message without `content` must still produce a non-empty
// text — the synthesized fallback uses customType so the timeline never carries
// a payload with an empty text field.
