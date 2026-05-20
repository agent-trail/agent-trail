import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter, validateAdapterTrail } from "../index.ts";
import { claudeCodeConfigDir, claudeCodeProjectDir, mangleCwd } from "./paths.ts";

let prevHome: string | undefined;
let prevUserProfile: string | undefined;
let prevClaudeConfigDir: string | undefined;
let prevCwd: string;
let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  prevCwd = process.cwd();
  tmpHome = mkdtempSync(join(tmpdir(), "cc-adapter-home-"));
  tmpCwd = mkdtempSync(join(tmpdir(), "cc-adapter-cwd-"));
  process.env.HOME = tmpHome;
  delete process.env.USERPROFILE;
  delete process.env.CLAUDE_CONFIG_DIR;
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
  if (prevClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = prevClaudeConfigDir;
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
  mkdirSync(createProjectDir(), { recursive: true });
  expect(await claudeCodeAdapter.isAvailable()).toBe(true);
});

function createProjectDir(): string {
  const configDir = claudeCodeConfigDir();
  if (configDir === undefined) throw new Error("test expected Claude config dir");
  const dir = claudeCodeProjectDir({ configDir, cwd: process.cwd() });
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("mangleCwd() normalizes Windows separators and drive colons", () => {
  expect(mangleCwd("C:\\Users\\somu\\repo")).toBe("C--Users-somu-repo");
  expect(mangleCwd("C:/Users/somu/repo")).toBe("C--Users-somu-repo");
});

test("isAvailable() falls back to USERPROFILE when HOME is unset", async () => {
  delete process.env.HOME;
  process.env.USERPROFILE = tmpHome;
  mkdirSync(createProjectDir(), { recursive: true });
  expect(await claudeCodeAdapter.isAvailable()).toBe(true);
});

test("detectSessions() honors CLAUDE_CONFIG_DIR", async () => {
  const customConfigDir = mkdtempSync(join(tmpdir(), "cc-adapter-config-"));
  process.env.CLAUDE_CONFIG_DIR = customConfigDir;
  try {
    const dir = createProjectDir();
    writeFileSync(join(dir, "sess-custom.jsonl"), "");
    expect(await claudeCodeAdapter.detectSessions()).toEqual([
      { id: "sess-custom", adapter: "claude-code", path: join(dir, "sess-custom.jsonl") },
    ]);
  } finally {
    rmSync(customConfigDir, { recursive: true, force: true });
  }
});

test("detectSessions() returns empty when project dir is missing", async () => {
  expect(await claudeCodeAdapter.detectSessions()).toEqual([]);
});

const FIXTURE_PATH = new URL("../../tests/fixtures/claude-code/basic-flow.jsonl", import.meta.url)
  .pathname;
const FIDELITY_FIXTURE_PATH = new URL(
  "../../tests/fixtures/claude-code/fidelity-edge-cases.jsonl",
  import.meta.url,
).pathname;

async function parseFixture() {
  return claudeCodeAdapter.parseSession({
    id: "basic-flow",
    adapter: "claude-code",
    path: FIXTURE_PATH,
  });
}

async function parseFidelityFixture() {
  return claudeCodeAdapter.parseSession({
    id: "fidelity-edge-cases",
    adapter: "claude-code",
    path: FIDELITY_FIXTURE_PATH,
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
    tool: "shell_command",
    args: { command: "ls" },
  });
  expect(toolCall?.semantic).toEqual({ call_id: "tooluse-1", tool_kind: "shell_command" });
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
  expect(toolResult?.semantic).toEqual({ call_id: "tooluse-1", tool_kind: "shell_command" });
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
    stop_reason: "end_turn",
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
  const text = `${[
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
      type: "file-history-snapshot",
      uuid: "snap-1",
      timestamp: "2026-05-17T14:00:03.000Z",
      sessionId: "s",
    }),
    JSON.stringify({
      parentUuid: "snap-1",
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "second" },
      uuid: "u-2",
      timestamp: "2026-05-17T14:00:04.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const u2 = trail.entries.find((e) => e.id === "u-2");
  expect(u2?.parent_id).toBe("u-1");
});

test("parseSession() filters attachment, sidechain, and isMeta records", async () => {
  const trail = await parseFixture();
  expect(trail.entries).toHaveLength(5);
  const ids = trail.entries.map((e) => e.id);
  expect(ids).not.toContain("cc-att-1");
  expect(ids).not.toContain("cc-sidechain-1");
  expect(ids).not.toContain("cc-meta-1");
});

test("parseSession() fans out mixed assistant blocks and multiple tool calls in source order", async () => {
  const trail = await parseFidelityFixture();
  const ids = trail.entries.map((e) => e.id);
  expect(ids.slice(0, 6)).toEqual([
    "cc-adv-1",
    "cc-adv-2-text-0",
    "cc-adv-2-thinking-1",
    "cc-adv-2-redacted_thinking-2",
    "cc-adv-2-tool_use-3",
    "cc-adv-2-tool_use-4",
  ]);

  const text = trail.entries.find((e) => e.id === "cc-adv-2-text-0");
  expect(text?.type).toBe("agent_message");
  expect(text?.parent_id).toBe("cc-adv-1");

  const thinking = trail.entries.find((e) => e.id === "cc-adv-2-thinking-1");
  expect(thinking?.type).toBe("agent_thinking");
  expect(thinking?.parent_id).toBe("cc-adv-2-text-0");

  const read = trail.entries.find((e) => e.id === "cc-adv-2-tool_use-3");
  expect(read?.type).toBe("tool_call");
  expect(read?.payload).toEqual({ tool: "file_read", args: { path: "package.json" } });
  expect(read?.semantic).toEqual({ call_id: "tooluse-read", tool_kind: "file_read" });

  const bash = trail.entries.find((e) => e.id === "cc-adv-2-tool_use-4");
  expect(bash?.type).toBe("tool_call");
  expect(bash?.payload).toEqual({ tool: "shell_command", args: { command: "bun run check" } });
  expect(bash?.parent_id).toBe("cc-adv-2-tool_use-3");
});

test("parseSession() emits multiple tool_results with error state and semantic pairing", async () => {
  const trail = await parseFidelityFixture();
  const readResult = trail.entries.find((e) => e.id === "cc-adv-3-tool_result-1");
  expect(readResult?.type).toBe("tool_result");
  expect(readResult?.payload).toEqual({
    for_id: "cc-adv-2-tool_use-3",
    ok: true,
    output: '{"name":"agent-trail"}',
  });
  expect(readResult?.semantic).toEqual({ call_id: "tooluse-read", tool_kind: "file_read" });

  const bashResult = trail.entries.find((e) => e.id === "cc-adv-3-tool_result-2");
  expect(bashResult?.type).toBe("tool_result");
  expect(bashResult?.payload).toEqual({
    for_id: "cc-adv-2-tool_use-4",
    ok: false,
    output: "error: synthetic check failure",
    error: "error: synthetic check failure",
  });
  expect(bashResult?.semantic).toEqual({ call_id: "tooluse-bash", tool_kind: "shell_command" });
});

test("parseSession() maps system, progress, queue, resume preamble, summary, and compact records", async () => {
  const trail = await parseFidelityFixture();
  expect(trail.entries.find((e) => e.id === "cc-adv-4")?.payload).toEqual({
    kind: "system",
    text: "<command-name>/model</command-name>",
  });
  expect(trail.entries.find((e) => e.id === "cc-adv-5")?.payload).toEqual({
    kind: "hook_progress",
    text: "Hook progress: PreToolUse (PreToolUse:Bash)",
    data: { type: "hook_progress", hookEvent: "PreToolUse", hookName: "PreToolUse:Bash" },
  });
  expect(trail.entries.find((e) => e.id === "cc-adv-6")?.payload).toEqual({
    kind: "queue_operation",
    text: "Queued input: queued follow-up while tool is running",
  });
  expect(trail.entries.find((e) => e.id === "cc-adv-7")?.type).toBe("system_event");
  expect(trail.entries.find((e) => e.id === "cc-adv-8")?.type).toBe("session_summary");
  expect(trail.entries.find((e) => e.id === "cc-adv-9")?.type).toBe("context_compact");
});

test("fidelity fixture round-trips through validateAdapterTrail with zero error diagnostics", async () => {
  const trail = await parseFidelityFixture();
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
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
  }
});

test("sourceVersion() is null when no sessions exist", async () => {
  expect(await claudeCodeAdapter.sourceVersion()).toBeNull();
});

test("sourceVersion() reads the version field from the most recent session", async () => {
  const dir = createProjectDir();
  const olderPath = join(dir, "older.jsonl");
  const newerPath = join(dir, "newer.jsonl");
  writeFileSync(
    olderPath,
    `${JSON.stringify({ type: "user", version: "0.9.0", sessionId: "older" })}\n`,
  );
  writeFileSync(
    newerPath,
    `${JSON.stringify({ type: "user", version: "1.0.0-synthetic", sessionId: "newer" })}\n`,
  );
  const olderMtime = new Date("2026-05-17T14:00:00.000Z");
  const newerMtime = new Date("2026-05-17T15:00:00.000Z");
  utimesSync(olderPath, olderMtime, olderMtime);
  utimesSync(newerPath, newerMtime, newerMtime);
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
