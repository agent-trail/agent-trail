import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { piAdapter, validateAdapterTrail } from "../index.ts";
import { mangleCwd, piAgentDir, piProjectDir, piSessionsDir } from "./paths.ts";
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

async function parseFixture() {
  return piAdapter.parseSession({
    id: "linear-flow",
    adapter: "pi",
    path: FIXTURE_PATH,
  });
}

// TDD step 1: piAdapter name + TrailAdapter shape
test("piAdapter has name 'pi'", () => {
  expect(piAdapter.name).toBe("pi");
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
  expect(trail.header).toEqual({
    type: "session",
    schema_version: "0.1.0",
    id: "sess-pi-1",
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
  const userMessage = trail.entries.find((e) => e.id === "pi-evt-1");
  expect(userMessage).toBeDefined();
  expect(userMessage?.type).toBe("user_message");
  expect(userMessage?.ts).toBe("2026-05-21T14:00:01.000Z");
  expect(userMessage?.payload).toEqual({ text: "please read spec.md" });
  expect(userMessage?.parent_id).toBeUndefined();
  expect(userMessage?.source?.original_type).toBe("message");
});

// TDD step 4: agent_message text mapping
test("parseSession() emits an agent_message for assistant text blocks with model and stop_reason", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.entries.find((e) => e.id === "pi-evt-4");
  expect(agentMsg).toBeDefined();
  expect(agentMsg?.type).toBe("agent_message");
  expect(agentMsg?.parent_id).toBe("pi-evt-3");
  expect(agentMsg?.payload).toEqual({
    text: "Spec loaded.",
    model: "claude-sonnet-4-5",
    stop_reason: "stop",
  });
});

// TDD step 5: tool_call mapping (read -> file_read)
test("parseSession() emits a tool_call for assistant toolCall blocks with semantic.call_id preserving toolCall.id", async () => {
  const trail = await parseFixture();
  const toolCall = trail.entries.find((e) => e.id === "pi-evt-2");
  expect(toolCall).toBeDefined();
  expect(toolCall?.type).toBe("tool_call");
  expect(toolCall?.parent_id).toBe("pi-evt-1");
  expect(toolCall?.payload).toEqual({
    tool: "file_read",
    args: { path: "spec.md" },
  });
  expect(toolCall?.semantic).toEqual({ call_id: "pi-call-1", tool_kind: "file_read" });
});

// TDD step 6: tool_result pairing via toolCallId
test("parseSession() emits a tool_result for toolResult envelopes linked via toolCallId to the tool_call event id", async () => {
  const trail = await parseFixture();
  const toolResult = trail.entries.find((e) => e.id === "pi-evt-3");
  expect(toolResult).toBeDefined();
  expect(toolResult?.type).toBe("tool_result");
  expect(toolResult?.parent_id).toBe("pi-evt-2");
  expect(toolResult?.payload).toEqual({
    for_id: "pi-evt-2",
    ok: true,
    output: "# Agent Trail Specification\n",
  });
  expect(toolResult?.semantic).toEqual({ call_id: "pi-call-1", tool_kind: "file_read" });
});

// TDD step 7: multi-entry assistant envelope chained via localParentId
test("parseSession() chains multi-block assistant entries via localParentId within a single envelope", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-multi",
      timestamp: "2026-05-21T15:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T15:00:01.000Z",
      message: { role: "user", content: "do something" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T15:00:02.000Z",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        stopReason: "toolUse",
        content: [
          { type: "text", text: "let me check" },
          { type: "toolCall", id: "call-x", name: "read", arguments: { path: "a.md" } },
        ],
      },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const ids = trail.entries.map((e) => e.id);
  expect(ids).toEqual(["u-1", "a-1-text-0", "a-1-toolCall-1"]);
  const text0 = trail.entries.find((e) => e.id === "a-1-text-0");
  expect(text0?.type).toBe("agent_message");
  expect(text0?.parent_id).toBe("u-1");
  const callBlock = trail.entries.find((e) => e.id === "a-1-toolCall-1");
  expect(callBlock?.type).toBe("tool_call");
  expect(callBlock?.parent_id).toBe("a-1-text-0");
});

test("parseSession() preserves source.raw.block_index relative to message.content (skips non-emitted block types)", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-bi",
      timestamp: "2026-05-21T16:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-bi-1",
      parentId: null,
      timestamp: "2026-05-21T16:00:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-bi-1",
      parentId: "u-bi-1",
      timestamp: "2026-05-21T16:00:02.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal" },
          { type: "text", text: "reply" },
          { type: "thinking", thinking: "more internal" },
          { type: "toolCall", id: "c-1", name: "read", arguments: { path: "x.md" } },
        ],
      },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const text0 = trail.entries.find((e) => e.id === "a-bi-1-text-0");
  const tool1 = trail.entries.find((e) => e.id === "a-bi-1-toolCall-1");
  expect((text0?.source?.raw as { block_index?: number }).block_index).toBe(1);
  expect((tool1?.source?.raw as { block_index?: number }).block_index).toBe(3);
});

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
    expect(await piAdapter.detectSessions()).toEqual([
      { id: "sess-custom", adapter: "pi", path: join(dir, "sess-custom.jsonl") },
    ]);
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
    expect(await piAdapter.detectSessions()).toEqual([
      { id: "sess-custom", adapter: "pi", path: join(dir, "sess-custom.jsonl") },
    ]);
  } finally {
    rmSync(customSessionsDir, { recursive: true, force: true });
  }
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
