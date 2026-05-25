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

test("parseSession() preserves source.raw.block_index relative to message.content across emittable block types", async () => {
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
  const thinking0 = trail.entries.find((e) => e.id === "a-bi-1-thinking-0");
  const text1 = trail.entries.find((e) => e.id === "a-bi-1-text-1");
  const thinking2 = trail.entries.find((e) => e.id === "a-bi-1-thinking-2");
  const tool3 = trail.entries.find((e) => e.id === "a-bi-1-toolCall-3");
  expect((thinking0?.source?.raw as { block_index?: number }).block_index).toBe(0);
  expect((text1?.source?.raw as { block_index?: number }).block_index).toBe(1);
  expect((thinking2?.source?.raw as { block_index?: number }).block_index).toBe(2);
  expect((tool3?.source?.raw as { block_index?: number }).block_index).toBe(3);

  // Envelope dedup: first emitted block inlines the source envelope; later
  // block-derived entries reference it via envelope_ref.
  const firstRaw = thinking0?.source?.raw as Record<string, unknown>;
  expect(firstRaw.envelope).toBeDefined();
  expect(firstRaw.envelope_ref).toBeUndefined();
  for (const later of [text1, thinking2, tool3]) {
    const raw = later?.source?.raw as Record<string, unknown>;
    expect(raw.envelope_ref).toBe(thinking0?.id);
    expect(raw.envelope).toBeUndefined();
  }
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
test("branch-flow produces a fork at pi-a1: both pi-u2 and pi-u3 reference it as parent_id", async () => {
  const trail = await parseBranchFixture();
  const childIds = new Set(trail.entries.filter((e) => e.parent_id === "pi-a1").map((e) => e.id));
  expect(childIds.has("pi-u2")).toBe(true);
  expect(childIds.has("pi-u3")).toBe(true);
});

// TDD step 3: branch_summary envelope produces a branch_summary entry with payload.summary
test("branch-flow emits a branch_summary entry carrying payload.summary from the Pi envelope", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.entries.find((e) => e.id === "pi-bs");
  expect(branchSummary).toBeDefined();
  expect(branchSummary?.type).toBe("branch_summary");
  expect((branchSummary?.payload as { summary?: string }).summary).toBe(
    "Explored X, switching to Y.",
  );
});

// TDD step 4: branch_summary entry's parent_id is resolved via the same parentId chain as messages
test("branch-flow branch_summary entry has parent_id resolved from envelope parentId (pi-a1)", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.entries.find((e) => e.id === "pi-bs");
  expect(branchSummary?.parent_id).toBe("pi-a1");
});

// TDD step 5: abandoned_branch_id walks fromId up to the divergence point with the active branch.
// Active leaf = last envelope in source order (pi-a3). Abandoned path from fromId pi-a2 = [pi-a2, pi-u2, pi-a1].
// Active path from pi-a3 = [pi-a3, pi-u3, pi-a1]. Shared root ancestor = pi-a1.
// Per spec §9.3 "root of abandoned branch" = topmost entry on abandoned side = child of divergence = pi-u2.
test("branch-flow branch_summary.abandoned_branch_id resolves to root of abandoned branch (pi-u2)", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.entries.find((e) => e.id === "pi-bs");
  const payload = branchSummary?.payload as { abandoned_branch_id?: string };
  expect(payload.abandoned_branch_id).toBe("pi-u2");
});

// TDD step 6: source.raw preserves the original Pi envelope (fromId, summary, details)
test("branch-flow branch_summary entry preserves the original envelope under source.raw", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.entries.find((e) => e.id === "pi-bs");
  const raw = branchSummary?.source?.raw as Record<string, unknown>;
  expect(raw?.type).toBe("branch_summary");
  expect(raw?.fromId).toBe("pi-a2");
  expect(raw?.summary).toBe("Explored X, switching to Y.");
  expect(raw?.details).toEqual({ readFiles: ["spec.md"], modifiedFiles: ["x.md"] });
});

// TDD step 7: Pi branch_summary.details surface in entry.metadata under reverse-domain key (spec §11)
test("branch-flow branch_summary entry mirrors Pi details into metadata['dev.pi.branch_details']", async () => {
  const trail = await parseBranchFixture();
  const branchSummary = trail.entries.find((e) => e.id === "pi-bs");
  const metadata = branchSummary?.metadata as Record<string, unknown> | undefined;
  expect(metadata).toBeDefined();
  expect(metadata?.["dev.pi.branch_details"]).toEqual({
    readFiles: ["spec.md"],
    modifiedFiles: ["x.md"],
  });
});

// TDD step 8: degenerate case — fromId is an ancestor of the active leaf.
// Divergence walk can't refine; fall back to fromId's resolved entry id so the entry stays valid.
test("branch_summary with fromId on the active branch falls back to fromId's resolved entry id", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-edge-1",
      timestamp: "2026-05-21T18:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T18:00:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T18:00:02.000Z",
      message: { role: "assistant", content: "ok" },
    }),
    JSON.stringify({
      type: "branch_summary",
      id: "bs-1",
      parentId: "a-1",
      timestamp: "2026-05-21T18:00:03.000Z",
      fromId: "u-1",
      summary: "noop nav",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const branchSummary = trail.entries.find((e) => e.id === "bs-1");
  const payload = branchSummary?.payload as { abandoned_branch_id?: string };
  expect(payload.abandoned_branch_id).toBe("u-1");
});

// Real-session smoke regression: pi-mono can set fromId to an envelope type the adapter doesn't
// emit (session_info, model_change, custom, ...). When walking the abandoned chain hits a source id
// with no entry, the resolver must keep walking — never emit an abandoned_branch_id that no entry
// in the file actually carries.
test("branch_summary with fromId on an unmapped envelope climbs to the nearest mapped ancestor", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-edge-3",
      timestamp: "2026-05-21T20:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T20:00:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "session_info",
      id: "si-1",
      parentId: "u-1",
      timestamp: "2026-05-21T20:00:02.000Z",
    }),
    JSON.stringify({
      type: "branch_summary",
      id: "bs-1",
      parentId: "si-1",
      timestamp: "2026-05-21T20:00:03.000Z",
      fromId: "si-1",
      summary: "navigated through session_info",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const branchSummary = trail.entries.find((e) => e.id === "bs-1");
  const payload = branchSummary?.payload as { abandoned_branch_id?: string };
  const allEntryIds = new Set(trail.entries.map((e) => e.id));
  expect(payload.abandoned_branch_id).toBeDefined();
  expect(allEntryIds.has(payload.abandoned_branch_id as string)).toBe(true);
  expect(payload.abandoned_branch_id).toBe("u-1");
});

// TDD step 9: degenerate case — fromId references no envelope id in the file.
// Walk produces no shared ancestor; fall back to the verbatim fromId string so payload stays valid.
test("branch_summary with unknown fromId falls back to the verbatim fromId string", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-edge-2",
      timestamp: "2026-05-21T19:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T19:00:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "branch_summary",
      id: "bs-1",
      parentId: "u-1",
      timestamp: "2026-05-21T19:00:02.000Z",
      fromId: "missing-source-id",
      summary: "dangling fromId",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const branchSummary = trail.entries.find((e) => e.id === "bs-1");
  const payload = branchSummary?.payload as { abandoned_branch_id?: string };
  expect(payload.abandoned_branch_id).toBe("missing-source-id");
});

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
test("branch_summary: each summary uses its own local active leaf (multi-branch session)", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  // Sequence of /tree navigations: start on A, jump to B (bs-1 abandons A), jump back to A
  // (bs-2 abandons B). Final file leaf is on A.
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-multi-bs",
      timestamp: "2026-05-21T23:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-root",
      parentId: null,
      timestamp: "2026-05-21T23:00:01.000Z",
      message: { role: "user", content: "start" },
    }),
    // Branch A
    JSON.stringify({
      type: "message",
      id: "a-A1",
      parentId: "u-root",
      timestamp: "2026-05-21T23:00:02.000Z",
      message: { role: "assistant", content: "A1" },
    }),
    JSON.stringify({
      type: "message",
      id: "u-A2",
      parentId: "a-A1",
      timestamp: "2026-05-21T23:00:03.000Z",
      message: { role: "user", content: "A2" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-A3",
      parentId: "u-A2",
      timestamp: "2026-05-21T23:00:04.000Z",
      message: { role: "assistant", content: "A3" },
    }),
    // Branch B (sibling of A at u-root), introduced via bs-1
    JSON.stringify({
      type: "message",
      id: "a-B1",
      parentId: "u-root",
      timestamp: "2026-05-21T23:00:05.000Z",
      message: { role: "assistant", content: "B1" },
    }),
    JSON.stringify({
      type: "branch_summary",
      id: "bs-1",
      parentId: "a-B1",
      timestamp: "2026-05-21T23:00:06.000Z",
      fromId: "a-A3",
      summary: "abandoned A, switching to B",
    }),
    JSON.stringify({
      type: "message",
      id: "u-B2",
      parentId: "bs-1",
      timestamp: "2026-05-21T23:00:07.000Z",
      message: { role: "user", content: "B2" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-B3",
      parentId: "u-B2",
      timestamp: "2026-05-21T23:00:08.000Z",
      message: { role: "assistant", content: "B3" },
    }),
    // Re-activate A via bs-2 (parent = A's deepest leaf).
    JSON.stringify({
      type: "branch_summary",
      id: "bs-2",
      parentId: "a-A3",
      timestamp: "2026-05-21T23:00:09.000Z",
      fromId: "a-B3",
      summary: "abandoned B, back to A",
    }),
    JSON.stringify({
      type: "message",
      id: "u-A4",
      parentId: "bs-2",
      timestamp: "2026-05-21T23:00:10.000Z",
      message: { role: "user", content: "A4" },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const bs1 = trail.entries.find((e) => e.id === "bs-1");
  const bs2 = trail.entries.find((e) => e.id === "bs-2");
  expect((bs1?.payload as { abandoned_branch_id?: string }).abandoned_branch_id).toBe("a-A1");
  // bs-2 was written when the user just jumped back to A. Local active leaf = a-A3.
  // Abandoned branch = B subtree.  Root of abandoned branch = a-B1 (child of u-root on B side).
  expect((bs2?.payload as { abandoned_branch_id?: string }).abandoned_branch_id).toBe("a-B1");
});

// Codex P2 regression: when the divergence node on the abandoned side is a Pi envelope that fans
// out into multiple Agent Trail entries (text + toolCall blocks in one assistant envelope),
// `abandoned_branch_id` must point at the **first** emitted entry of that envelope (the entry
// directly under the divergence parent), not the **last** entry. Returning the last entry
// misanchors the abandoned-branch root deeper than spec §9.3 intends and confuses tree renderers.
test("branch_summary: abandoned root resolves to the FIRST emitted entry of a multi-block envelope", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-multi",
      timestamp: "2026-05-21T22:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-root",
      parentId: null,
      timestamp: "2026-05-21T22:00:01.000Z",
      message: { role: "user", content: "go" },
    }),
    // Abandoned-side envelope that fans out to two entries: a-fork-text-0 + a-fork-toolCall-1.
    // Spec §9.3 "root of abandoned branch" = topmost on abandoned side = a-fork-text-0.
    JSON.stringify({
      type: "message",
      id: "a-fork",
      parentId: "u-root",
      timestamp: "2026-05-21T22:00:02.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "trying A" },
          { type: "toolCall", id: "call-A", name: "read", arguments: { path: "x.md" } },
        ],
      },
    }),
    JSON.stringify({
      type: "branch_summary",
      id: "bs-1",
      parentId: "u-root",
      timestamp: "2026-05-21T22:00:03.000Z",
      fromId: "a-fork",
      summary: "abandoned A, trying B",
    }),
    JSON.stringify({
      type: "message",
      id: "u-active",
      parentId: "u-root",
      timestamp: "2026-05-21T22:00:04.000Z",
      message: { role: "user", content: "try B" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-active",
      parentId: "u-active",
      timestamp: "2026-05-21T22:00:05.000Z",
      message: { role: "assistant", content: "B done" },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const branchSummary = trail.entries.find((e) => e.id === "bs-1");
  const payload = branchSummary?.payload as { abandoned_branch_id?: string };
  expect(payload.abandoned_branch_id).toBe("a-fork-text-0");
});

// Codex P1 regression: when the last envelope in source order is an unmapped type (session_info,
// label, model_change…), it must NOT be treated as the active leaf — those envelopes don't
// participate in the emitted entry graph, and using one collapses the shared-ancestor walk.
// File ends with trailing session_info; active leaf must be the prior `a-2` message envelope so
// the divergence walk against fromId=a-1 still returns u-abandon (root of abandoned branch).
test("branch_summary: trailing unmapped envelope does not become the active leaf", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-trail",
      timestamp: "2026-05-21T21:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-root",
      parentId: null,
      timestamp: "2026-05-21T21:00:01.000Z",
      message: { role: "user", content: "start" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-root",
      timestamp: "2026-05-21T21:00:02.000Z",
      message: { role: "assistant", content: "first try" },
    }),
    JSON.stringify({
      type: "message",
      id: "u-abandon",
      parentId: "u-root",
      timestamp: "2026-05-21T21:00:03.000Z",
      message: { role: "user", content: "branch A" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-abandon",
      parentId: "u-abandon",
      timestamp: "2026-05-21T21:00:04.000Z",
      message: { role: "assistant", content: "A done" },
    }),
    JSON.stringify({
      type: "branch_summary",
      id: "bs-1",
      parentId: "a-1",
      timestamp: "2026-05-21T21:00:05.000Z",
      fromId: "a-abandon",
      summary: "switched to active branch",
    }),
    JSON.stringify({
      type: "message",
      id: "u-active",
      parentId: "a-1",
      timestamp: "2026-05-21T21:00:06.000Z",
      message: { role: "user", content: "branch B" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-2",
      parentId: "u-active",
      timestamp: "2026-05-21T21:00:07.000Z",
      message: { role: "assistant", content: "B done" },
    }),
    // Trailing unmapped envelope rooted outside the conversational tree (parentId: null is a
    // shape pi-mono uses for top-level session metadata). Active-leaf detection must skip this
    // envelope; otherwise the divergence walk uses an active path that doesn't share any ancestor
    // with the abandoned path, collapses to the fromId fallback, and returns the *leaf* of the
    // abandoned branch instead of the abandoned branch root.
    JSON.stringify({
      type: "session_info",
      id: "si-trailing",
      parentId: null,
      timestamp: "2026-05-21T21:00:08.000Z",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const branchSummary = trail.entries.find((e) => e.id === "bs-1");
  const payload = branchSummary?.payload as { abandoned_branch_id?: string };
  // Active path = a-2 → u-active → a-1 → u-root.  Abandoned path from a-abandon = a-abandon →
  // u-abandon → u-root.  Shared ancestor = u-root.  Root of abandoned branch = u-abandon.
  expect(payload.abandoned_branch_id).toBe("u-abandon");
});

// Issue #20: Pi optional events + cross-cutting hardenings

// Slice 1: agent_thinking from assistant `thinking` content block (pi-ai ThinkingContent)
test("assistant `thinking` block emits agent_thinking with payload.text, preserving source order with siblings", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-think-1",
      timestamp: "2026-05-21T15:30:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T15:30:01.000Z",
      message: { role: "user", content: "think out loud" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T15:30:02.000Z",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        stopReason: "stop",
        content: [
          { type: "thinking", thinking: "deliberation step 1", thinkingSignature: "sig-1" },
          { type: "text", text: "final answer" },
        ],
      },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const ids = trail.entries.map((e) => e.id);
  expect(ids).toEqual(["u-1", "a-1-thinking-0", "a-1-text-1"]);
  const thinking = trail.entries.find((e) => e.id === "a-1-thinking-0");
  expect(thinking?.type).toBe("agent_thinking");
  expect(thinking?.parent_id).toBe("u-1");
  expect(thinking?.payload).toEqual({
    text: "deliberation step 1",
    model: "claude-sonnet-4-5",
  });
  expect(thinking?.source?.original_type).toBe("thinking");
  const rawBlock = (thinking?.source?.raw as { block?: { thinkingSignature?: string } }).block;
  expect(rawBlock?.thinkingSignature).toBe("sig-1");
});

// Slice 2: redacted-thinking placeholder (mirror claude-code adapter — text is opaque)
test("assistant `thinking` block with redacted:true emits agent_thinking with '[redacted thinking]' placeholder", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-redacted-1",
      timestamp: "2026-05-21T15:40:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T15:40:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T15:40:02.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", redacted: true, thinkingSignature: "opaque" },
          { type: "text", text: "answer" },
        ],
      },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const redacted = trail.entries.find((e) => e.id === "a-1-thinking-0");
  expect(redacted?.type).toBe("agent_thinking");
  expect((redacted?.payload as { text?: string }).text).toBe("[redacted thinking]");
});

// Slice 3: synthesized user_interrupt for assistant envelopes with stopReason === "aborted"
// (pi-ai `StopReason = ... | "aborted"` indicates the user interrupted mid-response).
test("assistant envelope with stopReason 'aborted' synthesizes a trailing user_interrupt entry", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-abort-1",
      timestamp: "2026-05-21T15:50:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T15:50:01.000Z",
      message: { role: "user", content: "long task" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T15:50:02.000Z",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        stopReason: "aborted",
        content: [{ type: "text", text: "starting" }],
      },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const interrupt = trail.entries.find((e) => e.id === "a-1-aborted");
  expect(interrupt).toBeDefined();
  expect(interrupt?.type).toBe("user_interrupt");
  expect(interrupt?.parent_id).toBe("a-1");
  expect(interrupt?.payload).toEqual({ reason: "stop_reason_aborted" });
  expect(interrupt?.source?.synthesized).toBe(true);
  expect(interrupt?.source?.original_type).toBe("assistant");
});

// Slice 3b: aborted with no emittable blocks — interrupt still synthesized; parent_id falls back
// to the envelope's parentId so the entry stays in the tree.
test("aborted assistant envelope with no emittable blocks still synthesizes a user_interrupt", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-abort-empty",
      timestamp: "2026-05-21T15:55:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T15:55:01.000Z",
      message: { role: "user", content: "x" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T15:55:02.000Z",
      message: { role: "assistant", stopReason: "aborted", content: [] },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const interrupt = trail.entries.find((e) => e.id === "a-1-aborted");
  expect(interrupt).toBeDefined();
  expect(interrupt?.type).toBe("user_interrupt");
  expect(interrupt?.parent_id).toBe("u-1");
});

// Slice 4: context_compact from Pi `compaction` envelope (pi-mono session-manager `CompactionEntry`)
test("Pi `compaction` envelope emits context_compact with summary/tokens_before/trigger and metadata mirror", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-compact-1",
      timestamp: "2026-05-21T16:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:00:01.000Z",
      message: { role: "user", content: "ramble" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T16:00:02.000Z",
      message: { role: "assistant", content: "long answer" },
    }),
    JSON.stringify({
      type: "compaction",
      id: "comp-1",
      parentId: "a-1",
      timestamp: "2026-05-21T16:00:03.000Z",
      summary: "Earlier turns established X and Y.",
      firstKeptEntryId: "a-1",
      tokensBefore: 12000,
      details: { artifacts: ["spec.md"] },
      fromHook: false,
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const compact = trail.entries.find((e) => e.id === "comp-1");
  expect(compact).toBeDefined();
  expect(compact?.type).toBe("context_compact");
  expect(compact?.parent_id).toBe("a-1");
  expect(compact?.payload).toEqual({
    summary: "Earlier turns established X and Y.",
    tokens_before: 12000,
    trigger: "auto",
  });
  const metadata = compact?.metadata as Record<string, unknown> | undefined;
  expect(metadata?.["dev.pi.compaction"]).toEqual({
    firstKeptEntryId: "a-1",
    details: { artifacts: ["spec.md"] },
    fromHook: false,
  });
  expect(compact?.source?.original_type).toBe("compaction");
});

// Slice 4b: tokensBefore as numeric string coerces to a tokens_before number (defense-in-depth,
// matches timestampToIso() polymorphic-parse philosophy).
test("Pi `compaction` envelope with tokensBefore as numeric string coerces to tokens_before number", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-compact-str",
      timestamp: "2026-05-21T16:05:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:05:01.000Z",
      message: { role: "user", content: "x" },
    }),
    JSON.stringify({
      type: "compaction",
      id: "comp-str",
      parentId: "u-1",
      timestamp: "2026-05-21T16:05:02.000Z",
      summary: "s",
      tokensBefore: "12000",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const compact = trail.entries.find((e) => e.id === "comp-str");
  expect((compact?.payload as { tokens_before?: number }).tokens_before).toBe(12000);
});

// PR #59 review (codex): missing/non-string `summary` on a `compaction` envelope must NOT emit a
// context_compact with an invented empty summary — downstream consumers can no longer distinguish
// a real empty summary from missing source data. Drop the entry instead.
test("Pi `compaction` envelope without a string summary emits no context_compact entry", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-comp-no-summary",
      timestamp: "2026-05-21T16:07:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:07:01.000Z",
      message: { role: "user", content: "x" },
    }),
    JSON.stringify({
      type: "compaction",
      id: "comp-bad",
      parentId: "u-1",
      timestamp: "2026-05-21T16:07:02.000Z",
      tokensBefore: 100,
    }),
    JSON.stringify({
      type: "message",
      id: "u-2",
      parentId: "comp-bad",
      timestamp: "2026-05-21T16:07:03.000Z",
      message: { role: "user", content: "after" },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  expect(trail.entries.find((e) => e.id === "comp-bad")).toBeUndefined();
  // Parent chain still resolves: u-2's source parentId points at the dropped envelope, so
  // resolveEntryParents() climbs to the nearest mapped ancestor (u-1).
  expect(trail.entries.find((e) => e.id === "u-2")?.parent_id).toBe("u-1");
});

// Slice 5: model_change from Pi `model_change` envelope (pi-mono session-manager `ModelChangeEntry`).
// from_model is the last assistant.message.model observed (or last model_change.modelId).
test("Pi `model_change` envelope emits model_change with to_model and from_model from prior assistant", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-mc-1",
      timestamp: "2026-05-21T16:10:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:10:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T16:10:02.000Z",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        content: "first",
      },
    }),
    JSON.stringify({
      type: "model_change",
      id: "mc-1",
      parentId: "a-1",
      timestamp: "2026-05-21T16:10:03.000Z",
      provider: "anthropic",
      modelId: "claude-opus-4-7",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const mc = trail.entries.find((e) => e.id === "mc-1");
  expect(mc).toBeDefined();
  expect(mc?.type).toBe("model_change");
  expect(mc?.parent_id).toBe("a-1");
  expect(mc?.payload).toEqual({
    from_model: "claude-sonnet-4-5",
    to_model: "claude-opus-4-7",
  });
  expect(mc?.source?.original_type).toBe("model_change");
  const metadata = mc?.metadata as Record<string, unknown> | undefined;
  expect(metadata?.["dev.pi.model_change"]).toEqual({ provider: "anthropic" });
});

// Slice 5b: first model_change with no prior assistant — emit to_model only (no from_model).
test("Pi `model_change` envelope with no prior model omits from_model", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-mc-2",
      timestamp: "2026-05-21T16:15:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:15:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "model_change",
      id: "mc-1",
      parentId: "u-1",
      timestamp: "2026-05-21T16:15:02.000Z",
      provider: "anthropic",
      modelId: "claude-opus-4-7",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const mc = trail.entries.find((e) => e.id === "mc-1");
  expect(mc?.payload).toEqual({ to_model: "claude-opus-4-7" });
});

// PR #59 review (codex): prevModel must only advance when the envelope actually emitted entries.
// Otherwise a missing-timestamp / dropped assistant or model_change can taint the next
// model_change's from_model with a value that never appears in the trail.
test("prevModel does not advance when the assistant envelope emits no entries (missing timestamp)", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-prev-skip",
      timestamp: "2026-05-21T16:20:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:20:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T16:20:02.000Z",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        content: "first",
      },
    }),
    // Missing timestamp -> buildEntries returns []. Pi-mono can't actually emit this shape, but
    // the parser must defend against partial source data so prevModel is not tainted.
    JSON.stringify({
      type: "message",
      id: "a-dropped",
      parentId: "a-1",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-opus-4-7",
        content: "ghost",
      },
    }),
    JSON.stringify({
      type: "model_change",
      id: "mc-1",
      parentId: "a-1",
      timestamp: "2026-05-21T16:20:04.000Z",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  // The dropped envelope contributed no entry...
  expect(trail.entries.find((e) => e.id === "a-dropped")).toBeUndefined();
  // ...so from_model on the model_change must still be the *last emitted* assistant model,
  // not the model on the dropped envelope.
  const mc = trail.entries.find((e) => e.id === "mc-1");
  expect(mc?.payload).toEqual({
    from_model: "claude-sonnet-4-5",
    to_model: "claude-haiku-4-5",
  });
});

test("prevModel does not advance when a model_change envelope is dropped (missing timestamp)", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-prev-mc-skip",
      timestamp: "2026-05-21T16:22:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:22:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T16:22:02.000Z",
      message: { role: "assistant", model: "claude-sonnet-4-5", content: "first" },
    }),
    JSON.stringify({
      type: "model_change",
      id: "mc-dropped",
      parentId: "a-1",
      provider: "anthropic",
      modelId: "claude-opus-4-7",
    }),
    JSON.stringify({
      type: "model_change",
      id: "mc-2",
      parentId: "a-1",
      timestamp: "2026-05-21T16:22:04.000Z",
      provider: "anthropic",
      modelId: "claude-haiku-4-5",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  expect(trail.entries.find((e) => e.id === "mc-dropped")).toBeUndefined();
  const mc2 = trail.entries.find((e) => e.id === "mc-2");
  expect(mc2?.payload).toEqual({
    from_model: "claude-sonnet-4-5",
    to_model: "claude-haiku-4-5",
  });
});

// Slice 6: polymorphic timestamp parser. Pi top-level envelopes are ISO today, but pi-mono
// internal messages (BashExecutionMessage, CompactionSummaryMessage) carry timestamp: Unix ms.
// Defense-in-depth: accept ISO string OR Unix ms (number/numeric string) at envelope boundary
// and emit a canonical ISO `ts`.
test("polymorphic timestamp: envelope with Unix ms `timestamp` parses to canonical ISO ts", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  // 2026-05-21T17:00:00.000Z = 1779742800000 ms (Date.UTC(2026,4,21,17,0,0) = 1779742800000)
  const ms = Date.UTC(2026, 4, 21, 17, 0, 0);
  const headerMs = Date.UTC(2026, 4, 21, 16, 59, 50);
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-ts",
      timestamp: headerMs,
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: ms,
      message: { role: "user", content: "ms ts" },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  expect(trail.header.ts).toBe("2026-05-21T16:59:50.000Z");
  const u = trail.entries.find((e) => e.id === "u-1");
  expect(u?.ts).toBe("2026-05-21T17:00:00.000Z");
});

// PR #59 review (codex): guard against out-of-range numeric timestamps. `new Date(...).toISOString()`
// throws RangeError for values outside JS Date's ±100M-day range (e.g., nanosecond-epoch values).
// One malformed envelope must not abort parsing for the whole session.
test("polymorphic timestamp: out-of-range numeric timestamp returns undefined (does not throw)", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  // 1e30 ms is far beyond JS Date's valid range (~8.64e15 ms max).
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-ts-bad",
      timestamp: "2026-05-21T17:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T17:00:01.000Z",
      message: { role: "user", content: "ok" },
    }),
    JSON.stringify({
      type: "message",
      id: "u-bad",
      parentId: "u-1",
      timestamp: 1e30,
      message: { role: "user", content: "out-of-range ts" },
    }),
  ].join("\n")}\n`;
  // Must not throw — the bad envelope is skipped, valid entries still emit.
  const trail = parsePiJsonl(text);
  expect(trail.entries.find((e) => e.id === "u-1")).toBeDefined();
  expect(trail.entries.find((e) => e.id === "u-bad")).toBeUndefined();
});

test("polymorphic timestamp: out-of-range Unix-ms numeric string returns undefined", async () => {
  const { timestampToIso } = await import("./source.ts");
  expect(timestampToIso(`1${"0".repeat(40)}`)).toBeUndefined();
});

test("polymorphic timestamp: ISO string passes through unchanged", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-ts-iso",
      timestamp: "2026-05-21T18:00:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T18:00:01.000Z",
      message: { role: "user", content: "iso ts" },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  expect(trail.header.ts).toBe("2026-05-21T18:00:00.000Z");
  expect(trail.entries[0]?.ts).toBe("2026-05-21T18:00:01.000Z");
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
test("every emitted entry stamps metadata['dev.pi.raw_type'] with the source variant tag", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-raw-type",
      timestamp: "2026-05-21T16:30:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:30:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T16:30:02.000Z",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        stopReason: "aborted",
        content: [
          { type: "thinking", thinking: "deliberate" },
          { type: "text", text: "partial" },
          { type: "toolCall", id: "c-1", name: "read", arguments: { path: "x.md" } },
        ],
      },
    }),
    JSON.stringify({
      type: "message",
      id: "tr-1",
      parentId: "a-1",
      timestamp: "2026-05-21T16:30:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "c-1",
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "ok" }],
      },
    }),
    JSON.stringify({
      type: "compaction",
      id: "comp-1",
      parentId: "tr-1",
      timestamp: "2026-05-21T16:30:04.000Z",
      summary: "x",
      tokensBefore: 100,
    }),
    JSON.stringify({
      type: "model_change",
      id: "mc-1",
      parentId: "comp-1",
      timestamp: "2026-05-21T16:30:05.000Z",
      provider: "anthropic",
      modelId: "claude-opus-4-7",
    }),
    JSON.stringify({
      type: "branch_summary",
      id: "bs-1",
      parentId: "mc-1",
      timestamp: "2026-05-21T16:30:06.000Z",
      fromId: "a-1-text-1",
      summary: "abandoned",
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const tagFor = (id: string) =>
    (trail.entries.find((e) => e.id === id)?.metadata as Record<string, unknown> | undefined)?.[
      "dev.pi.raw_type"
    ];
  expect(tagFor("u-1")).toBe("user_message_envelope");
  expect(tagFor("a-1-thinking-0")).toBe("assistant_thinking_block");
  expect(tagFor("a-1-text-1")).toBe("assistant_text_block");
  expect(tagFor("a-1-toolCall-2")).toBe("assistant_toolcall_block");
  expect(tagFor("a-1-aborted")).toBe("aborted_assistant_synthetic");
  expect(tagFor("tr-1")).toBe("tool_result_envelope");
  expect(tagFor("comp-1")).toBe("compaction_envelope");
  expect(tagFor("mc-1")).toBe("model_change_envelope");
  expect(tagFor("bs-1")).toBe("branch_summary_envelope");
});

// Slice 9: numeric tool-ID coercion (Cursor pattern). Pi-ai types ToolCall.id as string, but
// defense-in-depth: a non-conforming source emitting a numeric id must be coerced to a string
// canonical id before it can leak into semantic.call_id / tool_result.for_id.
test("non-conforming numeric toolCall.id is coerced to a string canonical call_id, and tool_result.for_id pairs correctly", async () => {
  const { parsePiJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      type: "session",
      version: 3,
      id: "sess-num-id",
      timestamp: "2026-05-21T16:45:00.000Z",
      cwd: "/tmp/synthetic-project",
    }),
    JSON.stringify({
      type: "message",
      id: "u-1",
      parentId: null,
      timestamp: "2026-05-21T16:45:01.000Z",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      type: "message",
      id: "a-1",
      parentId: "u-1",
      timestamp: "2026-05-21T16:45:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id: 42, name: "read", arguments: { path: "x.md" } }],
      },
    }),
    JSON.stringify({
      type: "message",
      id: "tr-1",
      parentId: "a-1",
      timestamp: "2026-05-21T16:45:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: 42,
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "ok" }],
      },
    }),
  ].join("\n")}\n`;
  const trail = parsePiJsonl(text);
  const toolCall = trail.entries.find((e) => e.type === "tool_call");
  expect(toolCall?.semantic?.call_id).toBe("42");
  const toolResult = trail.entries.find((e) => e.type === "tool_result");
  expect(toolResult?.semantic?.call_id).toBe("42");
  expect((toolResult?.payload as { for_id?: string }).for_id).toBe(toolCall?.id);
});

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
