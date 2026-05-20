import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter, validateAdapterTrail } from "../index.ts";

let prevHome: string | undefined;
let prevCwd: string;
let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevCwd = process.cwd();
  tmpHome = mkdtempSync(join(tmpdir(), "cc-adapter-home-"));
  tmpCwd = mkdtempSync(join(tmpdir(), "cc-adapter-cwd-"));
  process.env.HOME = tmpHome;
  process.chdir(tmpCwd);
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = prevHome;
  }
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpCwd, { recursive: true, force: true });
});

test("claudeCodeAdapter has name 'claude-code'", () => {
  expect(claudeCodeAdapter.name).toBe("claude-code");
});

test("isAvailable() is false when project dir does not exist", async () => {
  expect(await claudeCodeAdapter.isAvailable()).toBe(false);
});

test("isAvailable() is true after project dir is created", async () => {
  const mangled = process.cwd().replace(/\//g, "-");
  mkdirSync(join(tmpHome, ".claude", "projects", mangled), { recursive: true });
  expect(await claudeCodeAdapter.isAvailable()).toBe(true);
});

function createProjectDir(): string {
  const mangled = process.cwd().replace(/\//g, "-");
  const dir = join(tmpHome, ".claude", "projects", mangled);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("detectSessions() returns empty when project dir is missing", async () => {
  expect(await claudeCodeAdapter.detectSessions()).toEqual([]);
});

const FIXTURE_PATH = new URL("../../tests/fixtures/claude-code/basic-flow.jsonl", import.meta.url)
  .pathname;

async function parseFixture() {
  return claudeCodeAdapter.parseSession({
    id: "basic-flow",
    adapter: "claude-code",
    path: FIXTURE_PATH,
  });
}

test("parseSession() builds a header from sessionId, first ts, version, and cwd", async () => {
  const trail = await parseFixture();
  expect(trail.header).toEqual({
    type: "session",
    schema_version: "0.1.0",
    id: "sess-cc-1",
    ts: "2026-05-17T14:00:05.000Z",
    agent: { name: "claude-code", version: "1.0.0-synthetic" },
    cwd: "/tmp/synthetic-project",
    source: {
      agent: "claude-code",
      format_version: "1.0.0-synthetic",
    },
  });
});

test("parseSession() emits a user_message for user text records, with no parent_id when parentUuid is null", async () => {
  const trail = await parseFixture();
  const userMessage = trail.entries.find((e) => e.id === "cc-evt-1");
  expect(userMessage).toBeDefined();
  expect(userMessage?.type).toBe("user_message");
  expect(userMessage?.ts).toBe("2026-05-17T14:00:05.000Z");
  expect(userMessage?.payload).toEqual({ text: "please list the files" });
  expect(userMessage?.parent_id).toBeUndefined();
  expect(userMessage?.source?.original_type).toBe("user");
});

test("parseSession() emits a tool_call for assistant tool_use blocks, with semantic.call_id preserving tool_use_id", async () => {
  const trail = await parseFixture();
  const toolCall = trail.entries.find((e) => e.id === "cc-evt-2");
  expect(toolCall).toBeDefined();
  expect(toolCall?.type).toBe("tool_call");
  expect(toolCall?.parent_id).toBe("cc-evt-1");
  expect(toolCall?.payload).toEqual({
    tool: "other",
    args: { name: "Bash", args: { command: "ls" } },
  });
  expect(toolCall?.semantic).toEqual({ call_id: "tooluse-1" });
});

test("parseSession() emits a tool_result for user tool_result blocks linked back to the tool_call event id", async () => {
  const trail = await parseFixture();
  const toolResult = trail.entries.find((e) => e.id === "cc-evt-3");
  expect(toolResult).toBeDefined();
  expect(toolResult?.type).toBe("tool_result");
  expect(toolResult?.parent_id).toBe("cc-evt-2");
  expect(toolResult?.payload).toEqual({
    for_id: "cc-evt-2",
    ok: true,
    output: "file-a\nfile-b",
  });
  expect(toolResult?.semantic).toEqual({ call_id: "tooluse-1" });
});

test("parseSession() emits an agent_message for assistant text records with model", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.entries.find((e) => e.id === "cc-evt-4");
  expect(agentMsg).toBeDefined();
  expect(agentMsg?.type).toBe("agent_message");
  expect(agentMsg?.parent_id).toBe("cc-evt-3");
  expect(agentMsg?.payload).toEqual({
    text: "two files: file-a, file-b",
    model: "claude-opus-4-7",
  });
});

test("parseSession() emits a session_summary for summary records", async () => {
  const trail = await parseFixture();
  const summary = trail.entries.find((e) => e.id === "cc-evt-5");
  expect(summary).toBeDefined();
  expect(summary?.type).toBe("session_summary");
  expect(summary?.parent_id).toBe("cc-evt-4");
  expect(summary?.payload).toEqual({
    scope: "session",
    text: "listed files in working directory",
  });
});

test("parent_id walks through filtered ancestors to the nearest surviving event", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text =
    [
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "first" },
        uuid: "u-1",
        timestamp: "2026-05-17T14:00:01.000Z",
        sessionId: "s",
        version: "v",
      }),
      JSON.stringify({
        parentUuid: "u-1",
        isSidechain: false,
        type: "attachment",
        uuid: "att-1",
        timestamp: "2026-05-17T14:00:02.000Z",
        sessionId: "s",
      }),
      JSON.stringify({
        parentUuid: "att-1",
        isSidechain: false,
        type: "queue-operation",
        uuid: "qop-1",
        timestamp: "2026-05-17T14:00:03.000Z",
        sessionId: "s",
      }),
      JSON.stringify({
        parentUuid: "qop-1",
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "second" },
        uuid: "u-2",
        timestamp: "2026-05-17T14:00:04.000Z",
        sessionId: "s",
        version: "v",
      }),
    ].join("\n") + "\n";
  const trail = parseClaudeCodeJsonl(text);
  const u2 = trail.entries.find((e) => e.id === "u-2");
  expect(u2?.parent_id).toBe("u-1");
});

test("parseSession() filters queue-operation, attachment, sidechain, and isMeta records", async () => {
  const trail = await parseFixture();
  expect(trail.entries).toHaveLength(5);
  const ids = trail.entries.map((e) => e.id);
  expect(ids).not.toContain("cc-att-1");
  expect(ids).not.toContain("cc-sidechain-1");
  expect(ids).not.toContain("cc-meta-1");
});

test("parsed fixture round-trips through validateAdapterTrail with zero error diagnostics", async () => {
  const trail = await parseFixture();
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("every entry has source metadata: agent='claude-code', original_type populated, schema_version set, raw preserved", async () => {
  const trail = await parseFixture();
  for (const entry of trail.entries) {
    expect(entry.source?.agent).toBe("claude-code");
    expect(typeof entry.source?.original_type).toBe("string");
    expect(entry.source?.schema_version).toBe("1.0.0-synthetic");
    expect(entry.source?.raw).toBeDefined();
    expect((entry.source?.raw as { uuid?: unknown }).uuid).toBe(entry.id);
  }
});

test("sourceVersion() is null when no sessions exist", async () => {
  expect(await claudeCodeAdapter.sourceVersion()).toBeNull();
});

test("sourceVersion() reads the version field from the most recent session", async () => {
  const dir = createProjectDir();
  writeFileSync(
    join(dir, "older.jsonl"),
    `${JSON.stringify({ type: "user", version: "0.9.0", sessionId: "older" })}\n`,
  );
  writeFileSync(
    join(dir, "newer.jsonl"),
    `${JSON.stringify({ type: "user", version: "1.0.0-synthetic", sessionId: "newer" })}\n`,
  );
  expect(await claudeCodeAdapter.sourceVersion()).toBe("1.0.0-synthetic");
});

test("detectSessions() returns one SessionRef per .jsonl file, skipping other extensions", async () => {
  const dir = createProjectDir();
  writeFileSync(join(dir, "sess-a.jsonl"), "");
  writeFileSync(join(dir, "sess-b.jsonl"), "");
  writeFileSync(join(dir, "ignore.txt"), "");
  const refs = await claudeCodeAdapter.detectSessions();
  const sorted = [...refs].sort((a, b) => a.id.localeCompare(b.id));
  expect(sorted).toEqual([
    { id: "sess-a", adapter: "claude-code", path: join(dir, "sess-a.jsonl") },
    { id: "sess-b", adapter: "claude-code", path: join(dir, "sess-b.jsonl") },
  ]);
});
