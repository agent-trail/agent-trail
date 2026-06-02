import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCodeAdapter, validateAdapterTrail } from "../index.ts";
import { ID_PATTERN } from "../test-helpers.ts";
import { cleanGitEnv } from "../vcs.ts";
import { claudeCodeConfigDir, claudeCodeProjectDir, mangleCwd } from "./paths.ts";
import { toolKindAndArgs } from "./tools.ts";

// Surface tests assert on the shape returned by parseSession. Entry ids are an
// internal detail of the kit engine, so tests locate entries by type/content and
// assert linkage via the found entries' own ids — never by a reconstructed id.

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

test("claudeCodeAdapter parseSession emits a trail envelope", async () => {
  const trail = await parseFixture();
  expect(trail.envelope).toBeDefined();
  expect(trail.envelope?.type).toBe("trail");
  expect(trail.envelope?.schema_version).toBe("0.1.0");
  expect(trail.envelope?.producer).toMatch(/^@agent-trail\/adapters-claude-code\//);
  expect(typeof trail.envelope?.id).toBe("string");
  expect(typeof trail.envelope?.ts).toBe("string");
  expect(trail.envelope?.id).not.toBe(trail.groups[0]!.header.id);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
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
    const sessions = await claudeCodeAdapter.detectSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: "sess-custom",
      adapter: "claude-code",
      path: join(dir, "sess-custom.jsonl"),
    });
  } finally {
    rmSync(customConfigDir, { recursive: true, force: true });
  }
});

test("detectSessions() returns empty when project dir is missing", async () => {
  expect(await claudeCodeAdapter.detectSessions()).toEqual([]);
});

const FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/claude-code/basic-flow.jsonl", import.meta.url),
);
const FIDELITY_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/claude-code/fidelity-edge-cases.jsonl", import.meta.url),
);
const COMPACT_PROVENANCE_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/claude-code/compact-provenance.jsonl", import.meta.url),
);
const INTERRUPT_MODEL_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/claude-code/interrupt-and-model-change.jsonl", import.meta.url),
);
const PERMISSION_MODE_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/claude-code/permission-mode.jsonl", import.meta.url),
);
const CAPABILITY_CHANGES_FIXTURE_PATH = fileURLToPath(
  new URL("../../tests/fixtures/claude-code/capability-changes.jsonl", import.meta.url),
);

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

async function parseCompactProvenanceFixture() {
  return claudeCodeAdapter.parseSession({
    id: "compact-provenance",
    adapter: "claude-code",
    path: COMPACT_PROVENANCE_FIXTURE_PATH,
  });
}

async function parseInterruptModelFixture() {
  return claudeCodeAdapter.parseSession({
    id: "interrupt-and-model-change",
    adapter: "claude-code",
    path: INTERRUPT_MODEL_FIXTURE_PATH,
  });
}

async function parsePermissionModeFixture() {
  return claudeCodeAdapter.parseSession({
    id: "permission-mode",
    adapter: "claude-code",
    path: PERMISSION_MODE_FIXTURE_PATH,
  });
}

async function parseClaudeCodeJsonl(records: Record<string, unknown>[]) {
  const dir = mkdtempSync(join(tmpdir(), "cc-adapter-jsonl-"));
  try {
    const path = join(dir, "session.jsonl");
    writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
    return await claudeCodeAdapter.parseSession({
      id: "todo-write",
      adapter: "claude-code",
      path,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function parseCapabilityChangesFixture() {
  return claudeCodeAdapter.parseSession({
    id: "capability-changes",
    adapter: "claude-code",
    path: CAPABILITY_CHANGES_FIXTURE_PATH,
  });
}

test("parseSession() builds a header from sessionId, first ts, version, and cwd", async () => {
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
    id: "00000000-0000-0000-0000-ccccc0000001",
    ts: "2026-05-17T14:00:05.000Z",
    agent: { name: "claude-code", version: "1.0.0-synthetic" },
    cwd: "/tmp/synthetic-project",
    meta: {
      "dev.claudecode.entrypoint": "sdk-cli",
      "dev.claudecode.user_type": "external",
    },
    source: {
      agent: "claude-code",
      format_version: "1.0.0-synthetic",
    },
  });
});

test("parseSession() captures entrypoint and userType provenance into header.meta", async () => {
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000c0",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      cwd: "/tmp/synthetic-project",
      parentUuid: null,
      isSidechain: false,
      entrypoint: "sdk-cli",
      userType: "external",
      message: { role: "user", content: "hi" },
    },
  ]);
  const meta = trail.groups[0]!.header.meta;
  expect(meta?.["dev.claudecode.entrypoint"]).toBe("sdk-cli");
  expect(meta?.["dev.claudecode.user_type"]).toBe("external");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() sets requestId as semantic.group_id on assistant-derived entries", async () => {
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000d0",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      cwd: "/tmp/synthetic-project",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "list files" },
    },
    {
      type: "assistant",
      uuid: "00000000-0000-0000-0000-0000000000d1",
      timestamp: "2026-05-17T14:00:07.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      parentUuid: "00000000-0000-0000-0000-0000000000d0",
      requestId: "req-abc",
      message: {
        role: "assistant",
        model: "claude-opus-4-8",
        content: [
          { type: "text", text: "on it" },
          { type: "tool_use", id: "tooluse-x", name: "Bash", input: { command: "ls" } },
        ],
      },
    },
  ]);
  const entries = trail.groups[0]!.entries;
  const am = entries.find((e) => e.type === "agent_message");
  const tc = entries.find((e) => e.type === "tool_call");
  expect(am?.semantic?.group_id).toBe("req-abc");
  expect(tc?.semantic?.group_id).toBe("req-abc");
  // group_id must not clobber the tool_kind the reconciler relies on.
  expect(tc?.semantic?.tool_kind).toBeDefined();
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() emits a user_message for user text records, with no parent_id when parentUuid is null", async () => {
  const trail = await parseFixture();
  const userMessage = trail.groups[0]!.entries.find((e) => e.type === "user_message");
  expect(userMessage).toBeDefined();
  expect(userMessage?.ts).toBe("2026-05-17T14:00:05.000Z");
  expect(userMessage?.payload).toEqual({ text: "please list the files" });
  // The leading user record has no parentUuid → root of the linear chain.
  expect(userMessage?.parent_id).toBeNull();
  expect(userMessage?.source?.original_type).toBe("user");
});

test("parseSession() emits a tool_call for assistant tool_use blocks, with semantic.call_id preserving tool_use_id", async () => {
  const trail = await parseFixture();
  const idx = trail.groups[0]!.entries.findIndex((e) => e.type === "tool_call");
  const toolCall = trail.groups[0]!.entries[idx];
  expect(toolCall).toBeDefined();
  // Claude Code is a linear sequential chain — each entry parents off the entry
  // emitted immediately before it (here, the interposing queue system_event).
  expect(toolCall?.parent_id).toBe(trail.groups[0]!.entries[idx - 1]?.id);
  expect(toolCall?.payload).toEqual({
    tool: "shell_command",
    args: { command: "ls" },
  });
  expect(toolCall?.semantic).toEqual({
    group_id: "req_synthetic_01",
    call_id: "tooluse-1",
    tool_kind: "shell_command",
  });
});

test("parseSession() captures inline base64 image blocks as user_message attachments", async () => {
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000f0",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      cwd: "/tmp/synthetic-project",
      parentUuid: null,
      isSidechain: false,
      message: {
        role: "user",
        content: [
          { type: "text", text: "what is this screenshot" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
        ],
      },
    },
  ]);
  const um = trail.groups[0]!.entries.find((e) => e.type === "user_message");
  expect(um?.payload.text).toBe("what is this screenshot");
  const attachments = (um?.payload as { attachments?: unknown[] }).attachments;
  expect(attachments).toHaveLength(1);
  const att = attachments?.[0] as { kind?: string; media_type?: string; uri?: string };
  expect(att.kind).toBe("image");
  expect(att.media_type).toBe("image/png");
  expect(att.uri).toMatch(/^sha256:[0-9a-f]{64}$/);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() records subagent attribution on a tool_result entry.meta", async () => {
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000e0",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      cwd: "/tmp/synthetic-project",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "review it" },
    },
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000e1",
      timestamp: "2026-05-17T14:00:08.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      parentUuid: "00000000-0000-0000-0000-0000000000e0",
      isSidechain: false,
      sourceToolAssistantUUID: "asst-sub-1",
      toolUseResult: { agentId: "agent-7", agentType: "reviewer" },
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tooluse-task", content: "looks good" }],
      },
    },
  ]);
  const tr = trail.groups[0]!.entries.find((e) => e.type === "tool_result");
  expect(tr).toBeDefined();
  expect(tr?.meta?.["dev.claudecode.agent_id"]).toBe("agent-7");
  expect(tr?.meta?.["dev.claudecode.agent_type"]).toBe("reviewer");
  expect(tr?.meta?.["dev.claudecode.source_tool_assistant_uuid"]).toBe("asst-sub-1");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() emits a tool_result for user tool_result blocks linked back to the tool_call", async () => {
  const trail = await parseFixture();
  const toolCall = trail.groups[0]!.entries.find((e) => e.type === "tool_call");
  const toolResult = trail.groups[0]!.entries.find((e) => e.type === "tool_result");
  expect(toolResult).toBeDefined();
  expect(toolResult?.payload).toEqual({
    for_id: toolCall?.id,
    ok: true,
    output: "file-a\nfile-b",
  });
  expect(toolResult?.semantic).toEqual({ call_id: "tooluse-1", tool_kind: "shell_command" });
});

test("parseSession() bundles a direct Agent child session from subagents directory", async () => {
  const dir = createProjectDir();
  const parentId = "00000000-0000-0000-0000-aaaa00000001";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const childDir = join(dir, parentId, "subagents");
  mkdirSync(childDir, { recursive: true });
  const childPath = join(childDir, "agent-child-one.jsonl");

  writeFileSync(
    parentPath,
    `${[
      {
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "please delegate" },
        uuid: "00000000-0000-0000-0000-aaaa00000011",
        timestamp: "2026-05-17T14:00:05.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
      {
        parentUuid: "00000000-0000-0000-0000-aaaa00000011",
        isSidechain: false,
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-7",
          content: [
            {
              type: "tool_use",
              id: "agent-tool-1",
              name: "Agent",
              input: { prompt: "inspect parser", subagent_type: "reviewer" },
            },
          ],
          stop_reason: "tool_use",
        },
        uuid: "00000000-0000-0000-0000-aaaa00000012",
        timestamp: "2026-05-17T14:00:06.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
      {
        parentUuid: "00000000-0000-0000-0000-aaaa00000012",
        isSidechain: false,
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "agent-tool-1", content: "done" }],
        },
        uuid: "00000000-0000-0000-0000-aaaa00000013",
        timestamp: "2026-05-17T14:00:07.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
  );

  writeFileSync(
    childPath,
    `${[
      {
        parentUuid: null,
        isSidechain: true,
        type: "user",
        agentId: "child-one",
        message: { role: "user", content: "inspect parser" },
        uuid: "00000000-0000-0000-0000-bbbb00000011",
        timestamp: "2026-05-17T14:00:08.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
      {
        parentUuid: "00000000-0000-0000-0000-bbbb00000011",
        isSidechain: true,
        type: "assistant",
        agentId: "child-one",
        message: {
          role: "assistant",
          model: "claude-opus-4-7",
          content: [{ type: "text", text: "child inspected parser" }],
          stop_reason: "end_turn",
        },
        uuid: "00000000-0000-0000-0000-bbbb00000012",
        timestamp: "2026-05-17T14:00:09.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
  );

  const trail = await claudeCodeAdapter.parseSession({
    id: parentId,
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(2);
  const parent = trail.groups[0]!;
  const child = trail.groups[1]!;
  const invoke = parent.entries.find(
    (entry) => entry.type === "tool_call" && entry.payload.tool === "subagent_invoke",
  );
  expect(invoke).toBeDefined();
  expect(invoke?.payload).toEqual({
    tool: "subagent_invoke",
    args: { task: "inspect parser", agent_type: "reviewer", session_id: child.header.id },
  });
  expect(child.header.id).toMatch(ID_PATTERN);
  expect(child.header.id).not.toBe(parent.header.id);
  expect(child.header.fork_from).toEqual({ session_id: parent.header.id, entry_id: invoke?.id });
  expect(child.entries.some((entry) => entry.type === "agent_message")).toBe(true);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(diagnostics.some((d) => d.code.startsWith("child_session_"))).toBe(false);
});

test("parseSession() does not bundle a child file for duplicate Agent prompts", async () => {
  const dir = createProjectDir();
  const parentId = "00000000-0000-0000-0000-aaaa00000021";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const childDir = join(dir, parentId, "subagents");
  mkdirSync(childDir, { recursive: true });
  writeFileSync(
    parentPath,
    `${[
      {
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "delegate twice" },
        uuid: "00000000-0000-0000-0000-aaaa00000022",
        timestamp: "2026-05-17T14:00:05.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
      {
        parentUuid: "00000000-0000-0000-0000-aaaa00000022",
        isSidechain: false,
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-7",
          content: [
            {
              type: "tool_use",
              id: "agent-tool-1",
              name: "Agent",
              input: { prompt: "inspect parser", subagent_type: "reviewer" },
            },
            {
              type: "tool_use",
              id: "agent-tool-2",
              name: "Agent",
              input: { prompt: "inspect parser", subagent_type: "reviewer" },
            },
          ],
          stop_reason: "tool_use",
        },
        uuid: "00000000-0000-0000-0000-aaaa00000023",
        timestamp: "2026-05-17T14:00:06.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
  );
  writeFileSync(
    join(childDir, "agent-child-one.jsonl"),
    `${[
      {
        parentUuid: null,
        isSidechain: true,
        type: "user",
        agentId: "child-one",
        message: { role: "user", content: "inspect parser" },
        uuid: "00000000-0000-0000-0000-bbbb00000021",
        timestamp: "2026-05-17T14:00:08.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
  );

  const trail = await claudeCodeAdapter.parseSession({
    id: parentId,
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
  const invokes = trail.groups[0]!.entries.filter(
    (entry) => entry.type === "tool_call" && entry.payload.tool === "subagent_invoke",
  );
  expect(invokes).toHaveLength(2);
  expect(
    invokes.every((entry) => {
      const args = entry.payload.args as Record<string, unknown>;
      return !("session_id" in args);
    }),
  ).toBe(true);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() does not use raw Claude sessionId as a child directory path", async () => {
  const dir = createProjectDir();
  const parentPath = join(dir, "safe-parent.jsonl");
  const rawSessionId = "../escaped-parent";
  const escapedChildDir = join(dir, "..", "escaped-parent", "subagents");
  mkdirSync(escapedChildDir, { recursive: true });
  writeFileSync(
    parentPath,
    `${[
      {
        parentUuid: null,
        isSidechain: false,
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-7",
          content: [
            {
              type: "tool_use",
              id: "agent-tool-1",
              name: "Agent",
              input: { prompt: "inspect parser", subagent_type: "reviewer" },
            },
          ],
          stop_reason: "tool_use",
        },
        uuid: "00000000-0000-0000-0000-aaaa00000031",
        timestamp: "2026-05-17T14:00:06.000Z",
        sessionId: rawSessionId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
  );
  writeFileSync(
    join(escapedChildDir, "agent-child-one.jsonl"),
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: true,
      type: "user",
      agentId: "child-one",
      message: { role: "user", content: "inspect parser" },
      uuid: "00000000-0000-0000-0000-bbbb00000031",
      timestamp: "2026-05-17T14:00:08.000Z",
      sessionId: rawSessionId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );

  const trail = await claudeCodeAdapter.parseSession({
    id: "safe-parent",
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
});

test("parseSession() requires Claude child files to be sidechain records for the parent session", async () => {
  const dir = createProjectDir();
  const parentId = "00000000-0000-0000-0000-aaaa00000041";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const childDir = join(dir, parentId, "subagents");
  mkdirSync(childDir, { recursive: true });
  writeFileSync(
    parentPath,
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "agent-tool-1",
            name: "Agent",
            input: { prompt: "inspect parser", subagent_type: "reviewer" },
          },
        ],
        stop_reason: "tool_use",
      },
      uuid: "00000000-0000-0000-0000-aaaa00000042",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: parentId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );
  writeFileSync(
    join(childDir, "agent-child-one.jsonl"),
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      agentId: "child-one",
      message: { role: "user", content: "inspect parser" },
      uuid: "00000000-0000-0000-0000-bbbb00000041",
      timestamp: "2026-05-17T14:00:08.000Z",
      sessionId: "00000000-0000-0000-0000-cccc00000041",
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );

  const trail = await claudeCodeAdapter.parseSession({
    id: parentId,
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
});

test("parseSession() refuses mixed Claude child files even when one record has matching sidechain provenance", async () => {
  const dir = createProjectDir();
  const parentId = "00000000-0000-0000-0000-aaaa00000061";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const childDir = join(dir, parentId, "subagents");
  mkdirSync(childDir, { recursive: true });
  writeFileSync(
    parentPath,
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "agent-tool-1",
            name: "Agent",
            input: { prompt: "inspect parser", subagent_type: "reviewer" },
          },
        ],
        stop_reason: "tool_use",
      },
      uuid: "00000000-0000-0000-0000-aaaa00000062",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: parentId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );
  writeFileSync(
    join(childDir, "agent-child-one.jsonl"),
    `${[
      {
        parentUuid: null,
        isSidechain: true,
        type: "user",
        agentId: "child-one",
        message: { role: "user", content: "inspect parser" },
        uuid: "00000000-0000-0000-0000-bbbb00000061",
        timestamp: "2026-05-17T14:00:08.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
      {
        parentUuid: "00000000-0000-0000-0000-bbbb00000061",
        isSidechain: false,
        type: "assistant",
        agentId: "child-one",
        message: {
          role: "assistant",
          model: "claude-opus-4-7",
          content: [{ type: "text", text: "untrusted mixed transcript" }],
        },
        uuid: "00000000-0000-0000-0000-bbbb00000062",
        timestamp: "2026-05-17T14:00:09.000Z",
        sessionId: parentId,
        version: "1.0.0-synthetic",
        cwd: process.cwd(),
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n")}\n`,
  );

  const trail = await claudeCodeAdapter.parseSession({
    id: parentId,
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
});

test("parseSession() skips malformed Claude child files instead of failing parent parse", async () => {
  const dir = createProjectDir();
  const parentId = "00000000-0000-0000-0000-aaaa00000051";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const childDir = join(dir, parentId, "subagents");
  mkdirSync(childDir, { recursive: true });
  writeFileSync(
    parentPath,
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "agent-tool-1",
            name: "Agent",
            input: { prompt: "inspect parser", subagent_type: "reviewer" },
          },
        ],
        stop_reason: "tool_use",
      },
      uuid: "00000000-0000-0000-0000-aaaa00000052",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: parentId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );
  writeFileSync(join(childDir, "agent-child-one.jsonl"), "not-json\n");

  const trail = await claudeCodeAdapter.parseSession({
    id: parentId,
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
});

test("parseSession() skips non-object Claude child records instead of failing parent parse", async () => {
  const dir = createProjectDir();
  const parentId = "00000000-0000-0000-0000-aaaa00000071";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const childDir = join(dir, parentId, "subagents");
  mkdirSync(childDir, { recursive: true });
  writeFileSync(
    parentPath,
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "agent-tool-1",
            name: "Agent",
            input: { prompt: "inspect parser", subagent_type: "reviewer" },
          },
        ],
        stop_reason: "tool_use",
      },
      uuid: "00000000-0000-0000-0000-aaaa00000072",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: parentId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );
  writeFileSync(join(childDir, "agent-child-one.jsonl"), "null\n");

  const trail = await claudeCodeAdapter.parseSession({
    id: parentId,
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
});

test("parseSession() does not follow a symlinked Claude subagents directory", async () => {
  const dir = createProjectDir();
  const parentId = "00000000-0000-0000-0000-aaaa00000081";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const outsideChildDir = mkdtempSync(join(tmpdir(), "cc-adapter-linked-child-dir-"));
  symlinkSync(outsideChildDir, join(dir, parentId), "dir");
  writeFileSync(
    parentPath,
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "agent-tool-1",
            name: "Agent",
            input: { prompt: "inspect parser", subagent_type: "reviewer" },
          },
        ],
        stop_reason: "tool_use",
      },
      uuid: "00000000-0000-0000-0000-aaaa00000082",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: parentId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );
  mkdirSync(join(outsideChildDir, "subagents"), { recursive: true });
  writeFileSync(
    join(outsideChildDir, "subagents", "agent-child-one.jsonl"),
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: true,
      type: "user",
      agentId: "child-one",
      message: { role: "user", content: "inspect parser" },
      uuid: "00000000-0000-0000-0000-bbbb00000081",
      timestamp: "2026-05-17T14:00:08.000Z",
      sessionId: parentId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );

  const trail = await claudeCodeAdapter.parseSession({
    id: parentId,
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
  rmSync(outsideChildDir, { recursive: true, force: true });
});

test("parseSession() does not follow symlinked Claude child files", async () => {
  const dir = createProjectDir();
  const parentId = "00000000-0000-0000-0000-aaaa00000091";
  const parentPath = join(dir, `${parentId}.jsonl`);
  const childDir = join(dir, parentId, "subagents");
  mkdirSync(childDir, { recursive: true });
  const outsideChildDir = mkdtempSync(join(tmpdir(), "cc-adapter-linked-child-file-"));
  const outsideChildFile = join(outsideChildDir, "agent-child-one.jsonl");
  writeFileSync(
    parentPath,
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "agent-tool-1",
            name: "Agent",
            input: { prompt: "inspect parser", subagent_type: "reviewer" },
          },
        ],
        stop_reason: "tool_use",
      },
      uuid: "00000000-0000-0000-0000-aaaa00000092",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: parentId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );
  writeFileSync(
    outsideChildFile,
    `${JSON.stringify({
      parentUuid: null,
      isSidechain: true,
      type: "user",
      agentId: "child-one",
      message: { role: "user", content: "inspect parser" },
      uuid: "00000000-0000-0000-0000-bbbb00000091",
      timestamp: "2026-05-17T14:00:08.000Z",
      sessionId: parentId,
      version: "1.0.0-synthetic",
      cwd: process.cwd(),
    })}\n`,
  );
  symlinkSync(outsideChildFile, join(childDir, "agent-child-one.jsonl"), "file");

  const trail = await claudeCodeAdapter.parseSession({
    id: parentId,
    adapter: "claude-code",
    path: parentPath,
  });

  expect(trail.groups).toHaveLength(1);
  rmSync(outsideChildDir, { recursive: true, force: true });
});

test("parseSession() maps TodoWrite snapshots to task_plan_update and drops matching acks", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000131",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1301",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "please keep a plan" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1301",
      type: "assistant",
      uuid: "00000000-0000-0000-0000-cccccccc1302",
      timestamp: "2026-05-17T14:00:06.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "todo-write-1",
            name: "TodoWrite",
            input: {
              todos: [
                {
                  content: "Write failing test",
                  status: "pending",
                  activeForm: "Writing failing test",
                },
                { content: "Implement change", status: "pending" },
              ],
            },
          },
        ],
      },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1302",
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1303",
      timestamp: "2026-05-17T14:00:07.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "todo-write-1", content: "ok" }],
      },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1303",
      type: "assistant",
      uuid: "00000000-0000-0000-0000-cccccccc1304",
      timestamp: "2026-05-17T14:00:08.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "todo-write-2",
            name: "TodoWrite",
            input: {
              todos: [
                {
                  content: "Write failing test",
                  status: "completed",
                  activeForm: "Writing failing test",
                },
                { content: "Implement change", status: "in_progress" },
              ],
            },
          },
        ],
      },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1304",
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1305",
      timestamp: "2026-05-17T14:00:09.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "todo-write-2", content: "ok" }],
      },
    },
  ]);

  const plans = trail.groups[0]!.entries.filter((entry) => entry.type === "task_plan_update");
  expect(plans).toHaveLength(2);
  expect(trail.groups[0]!.entries.some((entry) => entry.type === "tool_result")).toBe(false);
  expect(
    trail.groups[0]!.entries.some(
      (entry) =>
        entry.type === "tool_call" && (entry.payload as { tool?: unknown }).tool === "task_plan",
    ),
  ).toBe(false);

  const firstPayload = plans[0]?.payload as {
    items: Array<{ id: string; content: string; status: string; active_form?: string }>;
    deltas: Array<Record<string, unknown>>;
  };
  const secondPayload = plans[1]?.payload as {
    items: Array<{ id: string; content: string; status: string; active_form?: string }>;
    deltas: Array<Record<string, unknown>>;
  };
  const firstItemId = firstPayload.items[0]?.id;
  const secondItemId = firstPayload.items[1]?.id;
  if (firstItemId === undefined || secondItemId === undefined) {
    throw new Error("expected two task plan item ids");
  }
  expect(firstPayload.items).toEqual([
    {
      id: firstItemId,
      content: "Write failing test",
      status: "pending",
      active_form: "Writing failing test",
    },
    { id: secondItemId, content: "Implement change", status: "pending" },
  ]);
  expect(firstPayload.deltas.map((delta) => delta.kind)).toEqual(["added", "added"]);
  expect(secondPayload.items.map((item) => item.id)).toEqual(
    firstPayload.items.map((item) => item.id),
  );
  expect(secondPayload.deltas).toContainEqual({
    kind: "status_changed",
    item_id: firstItemId,
    from_status: "pending",
    to_status: "completed",
  });
  expect(secondPayload.deltas).toContainEqual({
    kind: "status_changed",
    item_id: secondItemId,
    from_status: "pending",
    to_status: "in_progress",
  });

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() keeps failed TodoWrite results instead of dropping them as acks", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000132",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1321",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "please keep a plan" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1321",
      type: "assistant",
      uuid: "00000000-0000-0000-0000-cccccccc1322",
      timestamp: "2026-05-17T14:00:06.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "todo-write-failed",
            name: "TodoWrite",
            input: {
              todos: [{ content: "Write failing test", status: "pending" }],
            },
          },
        ],
      },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1322",
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1323",
      timestamp: "2026-05-17T14:00:07.000Z",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "todo-write-failed",
            is_error: true,
            content: "TodoWrite failed",
          },
        ],
      },
    },
  ]);

  const result = trail.groups[0]!.entries.find((entry) => entry.type === "tool_result");
  expect(result?.semantic?.call_id).toBe("todo-write-failed");
  expect(result?.payload).toEqual({
    ok: false,
    output: "TodoWrite failed",
    error: "TodoWrite failed",
  });

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() preserves source metadata and parentage when dropping first-block TodoWrite acks", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000133",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1331",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "please keep a plan and run a command" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1331",
      type: "assistant",
      uuid: "00000000-0000-0000-0000-cccccccc1332",
      timestamp: "2026-05-17T14:00:06.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [
          {
            type: "tool_use",
            id: "todo-write-ack-first",
            name: "TodoWrite",
            input: {
              todos: [{ content: "Write failing test", status: "pending" }],
            },
          },
          {
            type: "tool_use",
            id: "bash-after-plan",
            name: "Bash",
            input: { command: "printf real" },
          },
        ],
      },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1332",
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1333",
      timestamp: "2026-05-17T14:00:07.000Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "todo-write-ack-first", content: "ok" },
          { type: "tool_result", tool_use_id: "bash-after-plan", content: "real output" },
        ],
      },
    },
  ]);

  expect(
    trail.groups[0]!.entries.some(
      (entry) => entry.type === "tool_result" && entry.semantic?.call_id === "todo-write-ack-first",
    ),
  ).toBe(false);
  const shellCall = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_call" && entry.semantic?.call_id === "bash-after-plan",
  );
  const shellResult = trail.groups[0]!.entries.find(
    (entry) => entry.type === "tool_result" && entry.semantic?.call_id === "bash-after-plan",
  );
  expect(shellResult?.parent_id).toBe(shellCall?.id);
  const raw = shellResult?.source?.raw as Record<string, unknown> | undefined;
  expect(raw?.envelope).toBeDefined();
  expect(raw?.envelope_ref).toBeUndefined();

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() emits an agent_message for assistant text records with model", async () => {
  const trail = await parseFixture();
  const toolResult = trail.groups[0]!.entries.find((e) => e.type === "tool_result");
  const agentMsg = trail.groups[0]!.entries.find((e) => e.type === "agent_message");
  expect(agentMsg).toBeDefined();
  expect(agentMsg?.parent_id).toBe(toolResult?.id);
  expect(agentMsg?.payload).toEqual({
    text: "two files: file-a, file-b",
    model: "claude-opus-4-7",
    stop_reason: "end_turn",
    usage: {
      input_tokens: 18,
      output_tokens: 12,
      cache_read_tokens: 6,
      cache_creation_tokens: 2,
      context_input_tokens: 26,
    },
  });
  expect((agentMsg?.payload as { usage?: Record<string, unknown> }).usage).not.toHaveProperty(
    "context_window_tokens",
  );
});

test("parseSession() emits a session_summary for summary records", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.groups[0]!.entries.find((e) => e.type === "agent_message");
  const summary = trail.groups[0]!.entries.find((e) => e.type === "session_summary");
  expect(summary).toBeDefined();
  expect(summary?.parent_id).toBe(agentMsg?.id);
  expect(summary?.payload).toEqual({
    scope: "session",
    text: "listed files in working directory",
  });
});

test("parseSession() filters attachment, sidechain, and isMeta records", async () => {
  const trail = await parseFixture();
  // 5 message-derived entries + queue-operation + hook_success lifecycle marker.
  expect(trail.groups[0]!.entries).toHaveLength(7);
  const ids = trail.groups[0]!.entries.map((e) => e.id);
  expect(ids).not.toContain("00000000-0000-0000-0000-ccccccccaa11");
  expect(ids).not.toContain("00000000-0000-0000-0000-ccccccccdc11");
  expect(ids).not.toContain("00000000-0000-0000-0000-cccccccceee1");
});

test("parseSession() maps hook_success attachments to hook lifecycle markers", async () => {
  const trail = await parseFixture();
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" && entry.source?.original_type === "attachment.hook_success",
  );

  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("tooluse-1");
  expect(evt?.payload as { kind?: string; text?: string; data?: Record<string, unknown> }).toEqual({
    kind: "pre_tool_use",
    text: "Hook success: PreToolUse (PreToolUse:Bash)",
    data: {
      hook_event: "PreToolUse",
      hook_name: "PreToolUse:Bash",
      tool_call_id: "tooluse-1",
      exit_code: 0,
      duration_ms: 12,
      command: "/synthetic/hook.sh",
      stdout_excerpt: "{}\n",
      stderr_excerpt: "",
    },
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() truncates hook_success stdout and stderr excerpts", async () => {
  const stdout = "o".repeat(3000);
  const stderr = "e".repeat(3000);
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000aa",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      cwd: "/tmp/synthetic-project",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "run hook" },
    },
    {
      type: "attachment",
      uuid: "00000000-0000-0000-0000-0000000000ab",
      timestamp: "2026-05-17T14:00:06.100Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      parentUuid: "00000000-0000-0000-0000-cccccccccc12",
      attachment: {
        type: "hook_success",
        hookEvent: "PostToolUse",
        hookName: "PostToolUse:Bash",
        toolUseID: "tooluse-large",
        stdout,
        stderr,
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" && entry.source?.original_type === "attachment.hook_success",
  );
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;

  expect((data?.stdout_excerpt as string).length).toBeLessThan(stdout.length);
  expect((data?.stdout_excerpt as string).startsWith("o".repeat(2048))).toBe(true);
  expect((data?.stderr_excerpt as string).length).toBeLessThan(stderr.length);
  expect((data?.stderr_excerpt as string).startsWith("e".repeat(2048))).toBe(true);
  const rawAttachment = evt?.source?.raw?.attachment as Record<string, unknown> | undefined;
  expect(rawAttachment?.stdout).toBeUndefined();
  expect(rawAttachment?.stderr).toBeUndefined();
  expect(rawAttachment?.stdout_elided).toBe(true);
  expect(rawAttachment?.stdout_chars).toBe(stdout.length);
  expect(rawAttachment?.stderr_elided).toBe(true);
  expect(rawAttachment?.stderr_chars).toBe(stderr.length);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() omits blank hook_success tool ids from data and semantic", async () => {
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000ac",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      cwd: "/tmp/synthetic-project",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "run hook" },
    },
    {
      type: "attachment",
      uuid: "00000000-0000-0000-0000-0000000000ad",
      timestamp: "2026-05-17T14:00:06.100Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      parentUuid: "00000000-0000-0000-0000-0000000000ac",
      attachment: {
        type: "hook_success",
        hookEvent: "PreToolUse",
        hookName: "PreToolUse:Bash",
        toolUseID: "   ",
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" && entry.source?.original_type === "attachment.hook_success",
  );
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;

  expect(evt?.semantic?.call_id).toBeUndefined();
  expect(data?.tool_call_id).toBeUndefined();
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() uses normalized hook_success tool ids for semantic linkage", async () => {
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000ae",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      cwd: "/tmp/synthetic-project",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "run hook" },
    },
    {
      type: "attachment",
      uuid: "00000000-0000-0000-0000-0000000000af",
      timestamp: "2026-05-17T14:00:06.100Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      parentUuid: "00000000-0000-0000-0000-0000000000ae",
      attachment: {
        type: "hook_success",
        hookEvent: "PostToolUse",
        hookName: "PostToolUse:Bash",
        toolUseID: " tooluse-trimmed ",
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" && entry.source?.original_type === "attachment.hook_success",
  );
  const data = (evt?.payload as { data?: Record<string, unknown> }).data;

  expect(data?.tool_call_id).toBe("tooluse-trimmed");
  expect(evt?.semantic?.call_id).toBe("tooluse-trimmed");
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps hook_additional_context attachments to a system_event", async () => {
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000b0",
      timestamp: "2026-05-17T14:00:06.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      cwd: "/tmp/synthetic-project",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "build the thing" },
    },
    {
      type: "attachment",
      uuid: "00000000-0000-0000-0000-0000000000b1",
      timestamp: "2026-05-17T14:00:06.100Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      parentUuid: "00000000-0000-0000-0000-0000000000b0",
      attachment: {
        type: "hook_additional_context",
        hookEvent: "UserPromptSubmit",
        hookName: "inject-context",
        toolUseID: "tooluse-ctx",
        content: [{ type: "text", text: "CAVEMAN MODE ACTIVE" }],
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" &&
      entry.source?.original_type === "attachment.hook_additional_context",
  );

  expect(evt).toBeDefined();
  expect((evt?.payload as { kind?: string }).kind).toBe("x-claudecode/hook_additional_context");
  const payload = evt?.payload as { text?: string; data?: Record<string, unknown> };
  expect(payload.text).toContain("CAVEMAN MODE ACTIVE");
  expect(payload.data?.hook_event).toBe("UserPromptSubmit");
  expect(payload.data?.hook_name).toBe("inject-context");
  expect(payload.data?.content).toEqual([{ type: "text", text: "CAVEMAN MODE ACTIVE" }]);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps Claude Code capability attachment deltas", async () => {
  const trail = await parseCapabilityChangesFixture();
  const changes = trail.groups[0]!.entries.filter((entry) => entry.type === "capability_change");
  expect(changes.map((entry) => entry.payload)).toEqual([
    {
      scope: "tool",
      reason: "registered",
      added: [{ name: "ToolSearch" }, { name: "Task" }],
    },
    {
      scope: "tool",
      reason: "deregistered",
      removed: [{ name: "OldTool" }],
    },
    {
      scope: "skill",
      reason: "loaded",
      snapshot: [
        { name: "tdd", metadata: { description: "Test-driven development" } },
        { name: "code-review" },
      ],
    },
    {
      scope: "skill",
      reason: "loaded",
      changed: [
        {
          name: "skill_listing",
          field: "listing",
          to: "Available skills: tdd, code-review",
        },
      ],
    },
    {
      scope: "mcp_server",
      reason: "instructions_updated",
      changed: [
        {
          name: "linear",
          field: "instructions",
          to: "linear tools are now available",
        },
      ],
    },
  ]);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps command_permissions attachments to permission_request", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000173",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1731",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "run tests" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1731",
      type: "attachment",
      uuid: "00000000-0000-0000-0000-cccccccc1732",
      timestamp: "2026-05-17T14:00:06.000Z",
      attachment: {
        type: "command_permissions",
        allowed_tools: ["Bash(npm test)", "Bash(bun test)"],
        model: "claude-opus-4-7",
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" &&
      (entry.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt).toBeDefined();
  expect(evt?.source?.original_type).toBe("attachment.command_permissions");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    allowed_tools: ["Bash(npm test)", "Bash(bun test)"],
    model: "claude-opus-4-7",
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps top-level command_permissions to permission_request", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000177",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1771",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "run tests" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1771",
      type: "command_permissions",
      uuid: "00000000-0000-0000-0000-cccccccc1772",
      timestamp: "2026-05-17T14:00:06.000Z",
      allowed_tools: ["Bash(npm test)", "Bash(bun test)"],
      model: "claude-opus-4-7",
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" &&
      (entry.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt).toBeDefined();
  expect(evt?.source?.original_type).toBe("command_permissions");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    allowed_tools: ["Bash(npm test)", "Bash(bun test)"],
    model: "claude-opus-4-7",
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() preserves empty command_permissions allowed_tools", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000179",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1791",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "run tests" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1791",
      type: "attachment",
      uuid: "00000000-0000-0000-0000-cccccccc1792",
      timestamp: "2026-05-17T14:00:06.000Z",
      attachment: {
        type: "command_permissions",
        allowedTools: [],
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" &&
      (entry.payload as { kind?: string }).kind === "permission_request",
  );

  expect(evt).toBeDefined();
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    allowed_tools: [],
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps hook_permission_decision attachments to permission_decision", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000174",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1741",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "run tests" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1741",
      type: "attachment",
      uuid: "00000000-0000-0000-0000-cccccccc1742",
      timestamp: "2026-05-17T14:00:06.000Z",
      attachment: {
        type: "hook_permission_decision",
        decision: "allow",
        tool_call_id: " tooluse-bash-1 ",
        hook_event: "PreToolUse",
        capability: "Bash",
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" &&
      (entry.payload as { kind?: string }).kind === "permission_decision",
  );

  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("tooluse-bash-1");
  expect(evt?.source?.original_type).toBe("attachment.hook_permission_decision");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    decision: "allow",
    tool_call_id: "tooluse-bash-1",
    hook_event: "PreToolUse",
    capability: "Bash",
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps top-level hook_permission_decision to permission_decision", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000178",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1781",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "run tests" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1781",
      type: "hook_permission_decision",
      uuid: "00000000-0000-0000-0000-cccccccc1782",
      timestamp: "2026-05-17T14:00:06.000Z",
      decision: "allow",
      tool_call_id: "tooluse-bash-1",
      hook_event: "PreToolUse",
      capability: "Bash",
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" &&
      (entry.payload as { kind?: string }).kind === "permission_decision",
  );

  expect(evt).toBeDefined();
  expect(evt?.semantic?.call_id).toBe("tooluse-bash-1");
  expect(evt?.source?.original_type).toBe("hook_permission_decision");
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    decision: "allow",
    tool_call_id: "tooluse-bash-1",
    hook_event: "PreToolUse",
    capability: "Bash",
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() treats blank hook_permission_decision tool_call_id as missing", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000175",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1751",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "run tests" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1751",
      type: "attachment",
      uuid: "00000000-0000-0000-0000-cccccccc1752",
      timestamp: "2026-05-17T14:00:06.000Z",
      attachment: {
        type: "hook_permission_decision",
        decision: "deny",
        tool_call_id: "   ",
        hook_event: "PreToolUse",
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" &&
      (entry.payload as { kind?: string }).kind === "permission_decision",
  );

  expect(evt?.semantic?.call_id).toBeUndefined();
  expect((evt?.payload as { data?: Record<string, unknown> }).data).toEqual({
    decision: "deny",
    hook_event: "PreToolUse",
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() does not coerce hook_permission_decision abort into deny", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000176",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1761",
      timestamp: "2026-05-17T14:00:05.000Z",
      message: { role: "user", content: "run tests" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1761",
      type: "attachment",
      uuid: "00000000-0000-0000-0000-cccccccc1762",
      timestamp: "2026-05-17T14:00:06.000Z",
      attachment: {
        type: "hook_permission_decision",
        decision: "abort",
        tool_call_id: "tooluse-bash-1",
        hook_event: "PreToolUse",
      },
    },
  ]);
  const evt = trail.groups[0]!.entries.find(
    (entry) =>
      entry.type === "system_event" &&
      (entry.payload as { kind?: string }).kind === "permission_decision",
  );

  expect(evt).toBeUndefined();
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() fans out mixed assistant blocks and multiple tool calls in source order", async () => {
  const trail = await parseFidelityFixture();
  // Multi-block envelopes mint fresh UUIDs per block (see entry-metadata.ts);
  // assert source order + types instead of specific compound id strings. Block
  // call_ids preserved via semantic.call_id remain stable across runs.
  const types = trail.groups[0]!.entries.slice(0, 6).map((e) => e.type);
  expect(types).toEqual([
    "user_message",
    "agent_message",
    "agent_thinking",
    "agent_thinking",
    "tool_call",
    "tool_call",
  ]);

  const text = trail.groups[0]!.entries[1];
  expect(text?.type).toBe("agent_message");
  // The first agent block chains off the leading user_message (entries[0]).
  expect(text?.parent_id).toBe(trail.groups[0]!.entries[0]?.id);

  const thinking = trail.groups[0]!.entries[2];
  expect(thinking?.type).toBe("agent_thinking");
  expect(thinking?.parent_id).toBe(text?.id);

  const read = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-read",
  );
  expect(read).toBeDefined();
  expect(read?.payload).toEqual({ tool: "file_read", args: { path: "package.json" } });
  expect(read?.semantic).toEqual({
    group_id: "req_synthetic_adv_01",
    call_id: "tooluse-read",
    tool_kind: "file_read",
  });

  const bash = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-bash",
  );
  expect(bash).toBeDefined();
  expect(bash?.payload).toEqual({ tool: "shell_command", args: { command: "bun run check" } });
  expect(bash?.parent_id).toBe(read?.id);
});

test("toolKindAndArgs promotes common Claude tools out of other", () => {
  expect(toolKindAndArgs("ToolSearch", { query: "auth flow" })).toEqual({
    tool: "tool_search",
    args: { query: "auth flow" },
  });
  expect(toolKindAndArgs("Agent", { prompt: "Review this", subagent_type: "reviewer" })).toEqual({
    tool: "subagent_invoke",
    args: { task: "Review this", agent_type: "reviewer" },
  });
  expect(toolKindAndArgs("Bash", { command: "bun test" })).toEqual({
    tool: "shell_command",
    args: { command: "bun test" },
  });
});

test("AskUserQuestion emits structured user query and response events", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cc-user-input-answer-"));
  const path = join(tmp, "session.jsonl");
  try {
    const sessionId = "00000000-0000-0000-0000-ccccc0000100";
    const lines = [
      {
        parentUuid: null,
        isSidechain: false,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tooluse-question",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Ship it?",
                    header: "Ship",
                    multiSelect: false,
                    options: [
                      { label: "yes", description: "Ship now" },
                      { label: "no", description: "Hold" },
                    ],
                  },
                ],
              },
            },
          ],
        },
        type: "assistant",
        uuid: "00000000-0000-0000-0000-000000000100",
        timestamp: "2026-05-17T16:00:01.000Z",
        sessionId,
        version: "1.0.0-synthetic",
      },
      {
        parentUuid: "00000000-0000-0000-0000-000000000100",
        isSidechain: false,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tooluse-question",
              content:
                'User has answered your questions: "Ship it?"="yes". You can now continue...',
            },
          ],
        },
        type: "user",
        uuid: "00000000-0000-0000-0000-000000000101",
        timestamp: "2026-05-17T16:00:02.000Z",
        sessionId,
        version: "1.0.0-synthetic",
      },
    ];
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

    const trail = await claudeCodeAdapter.parseSession({
      id: sessionId,
      adapter: "claude-code",
      path,
    });
    const query = trail.groups[0]!.entries.find(
      (e) => e.type === "user_query" && e.semantic?.call_id === "tooluse-question",
    );
    const response = trail.groups[0]!.entries.find(
      (e) => e.type === "user_query_response" && e.semantic?.call_id === "tooluse-question",
    );
    if (query === undefined || response === undefined) {
      throw new Error("expected paired query entries");
    }
    const [question] = (query.payload as { questions: Array<{ id: string }> }).questions;
    if (question === undefined) throw new Error("expected query question");

    expect(query.payload).toEqual({
      questions: [
        {
          id: question.id,
          header: "Ship",
          question: "Ship it?",
          multi_select: false,
          options: [
            { label: "yes", description: "Ship now" },
            { label: "no", description: "Hold" },
          ],
        },
      ],
    });
    expect(response.payload).toEqual({
      for_id: query.id,
      answers: { [question.id]: { selected: ["yes"] } },
    });
    expect(
      trail.groups[0]!.entries.some(
        (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-question",
      ),
    ).toBe(false);
    expect(
      trail.groups[0]!.entries.some(
        (e) => e.type === "tool_result" && e.semantic?.call_id === "tooluse-question",
      ),
    ).toBe(false);
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("AskUserQuestion parses escaped quoted answers", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cc-user-input-quoted-answer-"));
  const path = join(tmp, "session.jsonl");
  try {
    const sessionId = "00000000-0000-0000-0000-ccccc0000150";
    const lines = [
      {
        parentUuid: null,
        isSidechain: false,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tooluse-question-quoted",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: 'Use "prod"?',
                    options: [{ label: "yes" }, { label: "no" }],
                  },
                ],
              },
            },
          ],
        },
        type: "assistant",
        uuid: "00000000-0000-0000-0000-000000000150",
        timestamp: "2026-05-17T16:05:01.000Z",
        sessionId,
        version: "1.0.0-synthetic",
      },
      {
        parentUuid: "00000000-0000-0000-0000-000000000150",
        isSidechain: false,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tooluse-question-quoted",
              content: String.raw`User has answered your questions: "Use \"prod\"?"="yes". You can now continue...`,
            },
          ],
        },
        type: "user",
        uuid: "00000000-0000-0000-0000-000000000151",
        timestamp: "2026-05-17T16:05:02.000Z",
        sessionId,
        version: "1.0.0-synthetic",
      },
    ];
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

    const trail = await claudeCodeAdapter.parseSession({
      id: sessionId,
      adapter: "claude-code",
      path,
    });
    const query = trail.groups[0]!.entries.find(
      (e) => e.type === "user_query" && e.semantic?.call_id === "tooluse-question-quoted",
    );
    const response = trail.groups[0]!.entries.find(
      (e) => e.type === "user_query_response" && e.semantic?.call_id === "tooluse-question-quoted",
    );
    const [question] = (query?.payload as { questions: Array<{ id: string }> }).questions;
    if (question === undefined) throw new Error("expected query question");

    expect(response?.payload).toEqual({
      for_id: query?.id,
      answers: { [question.id]: { selected: ["yes"] } },
    });
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("AskUserQuestion uses unique fallback ids and does not fan out duplicate-text answers", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cc-user-input-duplicate-question-"));
  const path = join(tmp, "session.jsonl");
  try {
    const sessionId = "00000000-0000-0000-0000-ccccc0000160";
    const lines = [
      {
        parentUuid: null,
        isSidechain: false,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tooluse-question-duplicate",
              name: "AskUserQuestion",
              input: {
                questions: [
                  { question: "Repeat?", options: [{ label: "yes" }, { label: "no" }] },
                  { question: "Repeat?", options: [{ label: "yes" }, { label: "no" }] },
                ],
              },
            },
          ],
        },
        type: "assistant",
        uuid: "00000000-0000-0000-0000-000000000160",
        timestamp: "2026-05-17T16:06:01.000Z",
        sessionId,
        version: "1.0.0-synthetic",
      },
      {
        parentUuid: "00000000-0000-0000-0000-000000000160",
        isSidechain: false,
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tooluse-question-duplicate",
              content: '"Repeat?"="yes"',
            },
          ],
        },
        type: "user",
        uuid: "00000000-0000-0000-0000-000000000161",
        timestamp: "2026-05-17T16:06:02.000Z",
        sessionId,
        version: "1.0.0-synthetic",
      },
    ];
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

    const trail = await claudeCodeAdapter.parseSession({
      id: sessionId,
      adapter: "claude-code",
      path,
    });
    const query = trail.groups[0]!.entries.find(
      (e) => e.type === "user_query" && e.semantic?.call_id === "tooluse-question-duplicate",
    );
    const response = trail.groups[0]!.entries.find(
      (e) =>
        e.type === "user_query_response" && e.semantic?.call_id === "tooluse-question-duplicate",
    );
    const questions = (query?.payload as { questions: Array<{ id: string }> }).questions;

    expect(questions.map((question) => question.id)).toHaveLength(2);
    expect(new Set(questions.map((question) => question.id)).size).toBe(2);
    expect(response?.payload).toEqual({ for_id: query?.id, answers: {} });
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("AskUserQuestion dismissed response emits empty answers", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cc-user-input-answer-large-"));
  const path = join(tmp, "session.jsonl");
  try {
    const sessionId = "00000000-0000-0000-0000-ccccc0000200";
    const lines = [
      {
        parentUuid: null,
        isSidechain: false,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tooluse-question-large",
              name: "AskUserQuestion",
              input: { question: "Ship?", choices: ["yes", "no"] },
            },
          ],
        },
        type: "assistant",
        uuid: "00000000-0000-0000-0000-000000000200",
        timestamp: "2026-05-17T16:10:01.000Z",
        sessionId,
        version: "1.0.0-synthetic",
      },
      {
        parentUuid: "00000000-0000-0000-0000-000000000200",
        isSidechain: false,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tooluse-question-large", content: "" }],
        },
        type: "user",
        uuid: "00000000-0000-0000-0000-000000000201",
        timestamp: "2026-05-17T16:10:02.000Z",
        sessionId,
        version: "1.0.0-synthetic",
      },
    ];
    writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

    const trail = await claudeCodeAdapter.parseSession({
      id: sessionId,
      adapter: "claude-code",
      path,
    });
    const query = trail.groups[0]!.entries.find(
      (e) => e.type === "user_query" && e.semantic?.call_id === "tooluse-question-large",
    );
    const response = trail.groups[0]!.entries.find(
      (e) => e.type === "user_query_response" && e.semantic?.call_id === "tooluse-question-large",
    );

    expect(response?.payload).toEqual({ for_id: query?.id, answers: {} });
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("parseSession() emits multiple tool_results with error state and semantic pairing", async () => {
  const trail = await parseFidelityFixture();
  // tool_call and tool_result block ids are fresh UUIDs at runtime, but the
  // tool_call's id is preserved as for_id on the paired tool_result. Pair by
  // semantic.call_id and verify the for_id linkage.
  const readCall = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-read",
  );
  const readResult = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_result" && e.semantic?.call_id === "tooluse-read",
  );
  expect(readCall).toBeDefined();
  expect(readResult?.type).toBe("tool_result");
  expect(readResult?.payload).toEqual({
    for_id: readCall?.id,
    ok: true,
    output: '{"name":"agent-trail"}',
  });
  expect(readResult?.semantic).toEqual({ call_id: "tooluse-read", tool_kind: "file_read" });

  const bashCall = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-bash",
  );
  const bashResult = trail.groups[0]!.entries.find(
    (e) => e.type === "tool_result" && e.semantic?.call_id === "tooluse-bash",
  );
  expect(bashCall).toBeDefined();
  expect(bashResult?.type).toBe("tool_result");
  expect(bashResult?.payload).toEqual({
    for_id: bashCall?.id,
    ok: false,
    output: "error: synthetic check failure",
    error: "error: synthetic check failure",
  });
  expect(bashResult?.semantic).toEqual({ call_id: "tooluse-bash", tool_kind: "shell_command" });
});

test("parseSession() maps system, progress, queue, resume preamble, summary, and compact records", async () => {
  const trail = await parseFidelityFixture();
  const byKind = (kind: string) =>
    trail.groups[0]!.entries.find((e) => (e.payload as { kind?: string })?.kind === kind);
  expect(byKind("x-claudecode/local_command")?.payload).toEqual({
    kind: "x-claudecode/local_command",
    text: "<command-name>/model</command-name>",
  });
  expect(byKind("pre_tool_use")?.payload).toEqual({
    kind: "pre_tool_use",
    text: "Hook progress: PreToolUse (PreToolUse:Bash)",
    data: { type: "hook_progress", hookEvent: "PreToolUse", hookName: "PreToolUse:Bash" },
  });
  expect(byKind("queue_operation")?.payload).toEqual({
    kind: "queue_operation",
    text: "Queued input: queued follow-up while tool is running",
  });
  // The resume preamble (continuation summary) maps to a session_start system_event.
  expect(byKind("session_start")?.type).toBe("system_event");
  const entries = trail.groups[0]!.entries;
  expect(entries.some((e) => e.type === "session_summary")).toBe(true);
  const compact = entries.find((e) => e.type === "context_compact");
  expect(compact).toBeDefined();
  expect(
    (compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids,
  ).toBeUndefined();
});

test("parseSession() maps compact_boundary provenance to the next compact summary", async () => {
  const trail = await parseCompactProvenanceFixture();
  const entries = trail.groups[0]!.entries;
  const compact = entries.find((e) => e.type === "context_compact");
  const compactBoundaryIndex = entries.findIndex(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind?: string }).kind === "x-claudecode/compact_boundary",
  );
  expect(compactBoundaryIndex).toBeGreaterThan(-1);
  const folded = entries.slice(0, compactBoundaryIndex).map((e) => e.id);
  expect(entries.slice(0, compactBoundaryIndex).map((e) => e.type)).toEqual([
    "user_message",
    "agent_message",
    "tool_call",
    "tool_result",
  ]);
  expect((compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids).toEqual(
    folded,
  );
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps real user-shaped compact summaries after compact_boundary", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0001763",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1801",
      timestamp: "2026-05-17T16:20:00.000Z",
      message: { role: "user", content: "fold this real-shaped turn" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1801",
      type: "system",
      subtype: "compact_boundary",
      level: "info",
      content: "Compact boundary",
      uuid: "00000000-0000-0000-0000-cccccccc1802",
      timestamp: "2026-05-17T16:20:01.000Z",
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1802",
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1803",
      timestamp: "2026-05-17T16:20:02.000Z",
      isCompactSummary: true,
      message: { role: "user", content: "Recovered Claude compact summary." },
    },
  ]);

  const entries = trail.groups[0]!.entries;
  const foldedUser = entries.find(
    (e) =>
      e.type === "user_message" &&
      (e.payload as { text?: string }).text === "fold this real-shaped turn",
  );
  const compact = entries.find((e) => e.type === "context_compact");
  if (foldedUser === undefined) throw new Error("expected folded user entry");
  expect((compact?.payload as { summary?: string }).summary).toBe(
    "Recovered Claude compact summary.",
  );
  expect((compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids).toEqual([
    foldedUser.id,
  ]);
  expect(
    entries.some(
      (e) =>
        e.type === "user_message" &&
        (e.payload as { text?: string }).text === "Recovered Claude compact summary.",
    ),
  ).toBe(false);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() lets a later compact_boundary supersede stale pending provenance", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0001762",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1761",
      timestamp: "2026-05-17T16:10:00.000Z",
      message: { role: "user", content: "before first boundary" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1761",
      type: "system",
      subtype: "compact_boundary",
      level: "info",
      content: "Compact boundary",
      uuid: "00000000-0000-0000-0000-cccccccc1762",
      timestamp: "2026-05-17T16:10:01.000Z",
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1762",
      type: "user",
      uuid: "00000000-0000-0000-0000-cccccccc1763",
      timestamp: "2026-05-17T16:10:02.000Z",
      message: { role: "user", content: "after stale boundary" },
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1763",
      type: "system",
      subtype: "compact_boundary",
      level: "info",
      content: "Compact boundary",
      uuid: "00000000-0000-0000-0000-cccccccc1764",
      timestamp: "2026-05-17T16:10:03.000Z",
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1764",
      type: "summary",
      summary: "Compacted the later segment.",
      leafUuid: "00000000-0000-0000-0000-cccccccc1763",
      isCompactSummary: true,
      uuid: "00000000-0000-0000-0000-cccccccc1765",
      timestamp: "2026-05-17T16:10:04.000Z",
    },
  ]);

  const entries = trail.groups[0]!.entries;
  const laterUser = entries.find(
    (e) =>
      e.type === "user_message" && (e.payload as { text?: string }).text === "after stale boundary",
  );
  const compact = entries.find((e) => e.type === "context_compact");
  if (laterUser === undefined) throw new Error("expected later user entry");
  expect((compact?.payload as { replaced_message_ids?: string[] }).replaced_message_ids).toEqual([
    laterUser.id,
  ]);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps Claude Code api_error to the reserved diagnostic kind", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000175",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "system",
      subtype: "api_error",
      content: "rate limit exceeded",
      uuid: "00000000-0000-0000-0000-cccccccc1751",
      timestamp: "2026-05-17T14:00:05.000Z",
    },
  ]);

  const event = trail.groups[0]!.entries.find((entry) => entry.type === "system_event");
  expect(event?.payload).toEqual({
    kind: "api_error",
    text: "rate limit exceeded",
    data: { severity: "error", details: "rate limit exceeded" },
  });

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() emits hook_failed events from stop_hook_summary hookErrors", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000176",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "system",
      subtype: "stop_hook_summary",
      content: "Stop hook summary",
      hookErrors: [
        {
          hookName: "Stop:test",
          message: "tests failed",
          code: "exit_1",
          blocking: true,
        },
        {
          hookName: "Stop:notify",
          stderr: "notification hook failed",
          code: 2,
          blocking: false,
        },
      ],
      uuid: "00000000-0000-0000-0000-cccccccc1761",
      timestamp: "2026-05-17T14:00:05.000Z",
    },
  ]);

  const events = trail.groups[0]!.entries.filter((entry) => entry.type === "system_event");
  expect(events.map((entry) => entry.payload)).toEqual([
    { kind: "turn_end", text: "Stop hook summary" },
    {
      kind: "hook_failed",
      text: "Hook failed: Stop:test",
      data: {
        severity: "error",
        blocking: true,
        hook_name: "Stop:test",
        code: "exit_1",
        details: "tests failed",
      },
    },
    {
      kind: "hook_failed",
      text: "Hook failed: Stop:notify",
      data: {
        severity: "error",
        blocking: false,
        hook_name: "Stop:notify",
        code: "2",
        details: "notification hook failed",
      },
    },
  ]);
  const firstHookRaw = events[1]?.source?.raw as
    | { envelope?: { subtype?: string }; block?: { hookName?: string }; block_index?: number }
    | undefined;
  const secondHookRaw = events[2]?.source?.raw as
    | { block?: { hookName?: string }; block_index?: number }
    | undefined;
  expect(firstHookRaw?.envelope?.subtype).toBe("stop_hook_summary");
  expect(firstHookRaw?.block?.hookName).toBe("Stop:test");
  expect(firstHookRaw?.block_index).toBe(0);
  expect(secondHookRaw?.block?.hookName).toBe("Stop:notify");
  expect(secondHookRaw?.block_index).toBe(1);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() maps hook error attachments to hook_failed events", async () => {
  const base = {
    isSidechain: false,
    sessionId: "00000000-0000-0000-0000-ccccc0000177",
    version: "1.0.0-synthetic",
    cwd: "/tmp/synthetic-project",
  };
  const trail = await parseClaudeCodeJsonl([
    {
      ...base,
      parentUuid: null,
      type: "user",
      message: { role: "user", content: "run hooks" },
      uuid: "00000000-0000-0000-0000-cccccccc1771",
      timestamp: "2026-05-17T14:00:05.000Z",
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1771",
      type: "attachment",
      attachment: {
        type: "hook_blocking_error",
        hookName: "PreToolUse:Bash",
        message: "blocked command",
        code: "exit_2",
      },
      uuid: "00000000-0000-0000-0000-cccccccc1772",
      timestamp: "2026-05-17T14:00:06.000Z",
    },
    {
      ...base,
      parentUuid: "00000000-0000-0000-0000-cccccccc1772",
      type: "attachment",
      attachment: {
        type: "hook_non_blocking_error",
        hookName: "PostToolUse:Bash",
        message: "audit hook failed",
      },
      uuid: "00000000-0000-0000-0000-cccccccc1773",
      timestamp: "2026-05-17T14:00:07.000Z",
    },
  ]);

  const events = trail.groups[0]!.entries.filter(
    (entry) =>
      entry.type === "system_event" && (entry.payload as { kind?: string }).kind === "hook_failed",
  );
  expect(events.map((entry) => entry.payload)).toEqual([
    {
      kind: "hook_failed",
      text: "Hook failed: PreToolUse:Bash",
      data: {
        severity: "error",
        blocking: true,
        hook_name: "PreToolUse:Bash",
        code: "exit_2",
        details: "blocked command",
      },
    },
    {
      kind: "hook_failed",
      text: "Hook failed: PostToolUse:Bash",
      data: {
        severity: "error",
        blocking: false,
        hook_name: "PostToolUse:Bash",
        details: "audit hook failed",
      },
    },
  ]);

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession() emits v0.1-shaped deterministic entry ids across synthesized-entry fixtures", async () => {
  const first = await parseFixture();
  const second = await parseFixture();
  expect(first.groups[0]!.entries.map((e) => e.id)).toEqual(
    second.groups[0]!.entries.map((e) => e.id),
  );
  for (const entry of first.groups[0]!.entries) expect(entry.id).toMatch(ID_PATTERN);
  expect(
    first.groups[0]!.entries.some(
      (e) =>
        e.type === "system_event" && (e.payload as { kind?: string }).kind === "queue_operation",
    ),
  ).toBe(true);

  const model = await parseInterruptModelFixture();
  const modelAgain = await parseInterruptModelFixture();
  expect(model.groups[0]!.entries.map((e) => e.id)).toEqual(
    modelAgain.groups[0]!.entries.map((e) => e.id),
  );
  for (const entry of model.groups[0]!.entries) expect(entry.id).toMatch(ID_PATTERN);
  expect(model.groups[0]!.entries.some((e) => e.type === "model_change")).toBe(true);

  const permission = await parsePermissionModeFixture();
  const permissionAgain = await parsePermissionModeFixture();
  expect(permission.groups[0]!.entries.map((e) => e.id)).toEqual(
    permissionAgain.groups[0]!.entries.map((e) => e.id),
  );
  for (const entry of permission.groups[0]!.entries) expect(entry.id).toMatch(ID_PATTERN);
  expect(
    permission.groups[0]!.entries.some(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "permission_mode_change",
    ),
  ).toBe(true);
});

test("interrupt-and-model-change fixture: emits user_interrupt and synthetic model_change in expected sequence", async () => {
  const trail = await parseInterruptModelFixture();
  const types = trail.groups[0]!.entries.map((e) => e.type);
  expect(types).toEqual([
    "user_message",
    "agent_message",
    "user_interrupt",
    "user_message",
    "model_change",
    "agent_message",
    "agent_message",
  ]);

  // Indices follow the sequence asserted above; assert linkage via those entries'
  // own ids rather than reconstructing the kit's internal id scheme.
  const interrupt = trail.groups[0]!.entries[2];
  expect(interrupt?.type).toBe("user_interrupt");
  expect(interrupt?.payload).toEqual({ reason: "user for tool use" });
  expect(interrupt?.parent_id).toBe(trail.groups[0]!.entries[1]?.id);

  const modelChange = trail.groups[0]!.entries.find((e) => e.type === "model_change");
  expect(modelChange?.type).toBe("model_change");
  expect(modelChange?.payload).toEqual({
    from_model: "claude-opus-4-7",
    to_model: "claude-sonnet-4-5",
  });
  expect(modelChange?.source?.synthesized).toBe(true);
  // model_change is synthesized before the second user_message's agent reply;
  // its parent is the preceding user_message (entries[3]).
  expect(modelChange?.parent_id).toBe(trail.groups[0]!.entries[3]?.id);

  const sonnetMsg = trail.groups[0]!.entries[5];
  expect(sonnetMsg?.type).toBe("agent_message");
  expect(sonnetMsg?.parent_id).toBe(modelChange?.id);

  expect(trail.groups[0]!.entries.filter((e) => e.type === "model_change")).toHaveLength(1);
});

test("interrupt-and-model-change fixture round-trips through validateAdapterTrail with zero error diagnostics", async () => {
  const trail = await parseInterruptModelFixture();
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
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

test("recognizes last-prompt / mode / bridge-session as benign — no quarantine, no entry", async () => {
  const trail = await parseClaudeCodeJsonl([
    {
      type: "user",
      uuid: "00000000-0000-0000-0000-0000000000a0",
      parentUuid: null,
      timestamp: "2026-05-18T10:00:00.000Z",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      message: { role: "user", content: "hi" },
    },
    {
      type: "last-prompt",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      lastPrompt: "hi",
      leafUuid: "00000000-0000-0000-0000-0000000000a0",
    },
    {
      type: "mode",
      mode: "normal",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
    },
    {
      type: "bridge-session",
      sessionId: "00000000-0000-0000-0000-ccccc0000001",
      version: "1.0.0-synthetic",
      bridgeSessionId: "cse_synthetic",
      lastSequenceNum: 0,
    },
  ]);
  const entries = trail.groups[0]!.entries;
  const quarantined = entries.filter(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind?: string }).kind === "x-claudecode/unknown_record",
  );
  expect(quarantined).toEqual([]);
  // The three benign records map to nothing; only the user_message survives.
  expect(entries.map((e) => e.type)).toEqual(["user_message"]);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("parseSession stamps timestamp-less drift quarantine from the nearest source timestamp", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cc-drift-ts-"));
  const path = join(tmp, "session.jsonl");
  try {
    const ts = "2026-05-18T10:00:00.000Z";
    const sessionId = "00000000-0000-0000-0000-ddddd00000d1";
    writeFileSync(
      path,
      `${JSON.stringify({
        type: "user",
        uuid: "00000000-0000-0000-0000-0000000000d1",
        parentUuid: null,
        timestamp: ts,
        sessionId,
        version: "1.0.0-synthetic",
        message: { role: "user", content: "hi" },
      })}\n${JSON.stringify({
        type: "totally-unknown-type",
        sessionId,
        version: "1.0.0-synthetic",
      })}\n`,
    );
    const trail = await claudeCodeAdapter.parseSession({
      id: sessionId,
      adapter: "claude-code",
      path,
    });
    const quarantine = trail.groups[0]!.entries.find(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "x-claudecode/unknown_record",
    );
    expect(quarantine?.ts).toBe(ts);
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("every entry has source metadata: agent='claude-code', original_type populated, schema_version set, raw preserved", async () => {
  const trail = await parseFixture();
  for (const entry of trail.groups[0]!.entries) {
    expect(entry.source?.agent).toBe("claude-code");
    expect(typeof entry.source?.original_type).toBe("string");
    expect(entry.source?.schema_version).toBe("1.0.0-synthetic");
    expect(entry.source?.raw).toBeDefined();
    expect(Object.hasOwn(entry, "meta")).toBe(false);
  }
});

test("fidelity-edge-cases trail output drops below 11 KB after envelope_ref dedup", async () => {
  // Before envelope_ref dedup this fixture serialized to ~15.1 KB; the bound
  // documents the floor after dedup (~10.1 KB at writing) without locking the
  // exact byte count.
  const trail = await parseFidelityFixture();
  const lines = [
    JSON.stringify(trail.groups[0]!.header),
    ...trail.groups[0]!.entries.map((e) => JSON.stringify(e)),
  ];
  const bytes = Buffer.byteLength(`${lines.join("\n")}\n`, "utf8");
  expect(bytes).toBeLessThan(13_000);
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
  expect(sorted.map((r) => ({ id: r.id, adapter: r.adapter, path: r.path }))).toEqual([
    { id: "sess-a", adapter: "claude-code", path: join(dir, "sess-a.jsonl") },
    { id: "sess-b", adapter: "claude-code", path: join(dir, "sess-b.jsonl") },
  ]);
});

test("detectSessions() populates cwd from session header and modifiedAt from file mtime", async () => {
  const dir = createProjectDir();
  const file = join(dir, "sess-h.jsonl");
  const header = { type: "session", sessionId: "sess-h", cwd: "/tmp/synthetic-project" };
  writeFileSync(file, `${JSON.stringify(header)}\n`);
  const mtime = new Date("2026-05-17T14:00:00.000Z");
  utimesSync(file, mtime, mtime);
  const refs = await claudeCodeAdapter.detectSessions();
  expect(refs).toHaveLength(1);
  expect(refs[0]).toEqual({
    id: "sess-h",
    adapter: "claude-code",
    path: file,
    cwd: "/tmp/synthetic-project",
    modifiedAt: "2026-05-17T14:00:00.000Z",
  });
});

test("detectSessions({ allCwds: true }) walks every project dir under projects root", async () => {
  const configDir = claudeCodeConfigDir();
  if (configDir === undefined) throw new Error("test expected Claude config dir");
  const projects = join(configDir, "projects");
  const dirA = join(projects, "-tmp-proj-a");
  const dirB = join(projects, "-tmp-proj-b");
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  writeFileSync(
    join(dirA, "sess-a.jsonl"),
    `${JSON.stringify({ type: "session", sessionId: "sess-a", cwd: "/tmp/proj/a" })}\n`,
  );
  writeFileSync(
    join(dirB, "sess-b.jsonl"),
    `${JSON.stringify({ type: "session", sessionId: "sess-b", cwd: "/tmp/proj/b" })}\n`,
  );
  const refs = await claudeCodeAdapter.detectSessions({ allCwds: true });
  const byId = [...refs].sort((a, b) => a.id.localeCompare(b.id));
  expect(byId.map((r) => ({ id: r.id, cwd: r.cwd }))).toEqual([
    { id: "sess-a", cwd: "/tmp/proj/a" },
    { id: "sess-b", cwd: "/tmp/proj/b" },
  ]);
});

test("parseSession() populates vcs.remote_url from header.cwd when cwd is a git working tree with an origin remote", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "cc-vcs-repo-"));
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
    await git(["remote", "add", "origin", "https://github.com/agent-trail/agent-trail.git"]);

    const record = {
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "00000000-0000-0000-0000-0ea0d628f3cb",
      timestamp: "2026-05-17T14:00:05.000Z",
      sessionId: "sess-cc-vcs",
      version: "1.0.0-synthetic",
      cwd: repoDir,
    };
    const fixturePath = join(repoDir, "session.jsonl");
    writeFileSync(fixturePath, `${JSON.stringify(record)}\n`);

    const trail = await claudeCodeAdapter.parseSession({
      id: "sess-cc-vcs",
      adapter: "claude-code",
      path: fixturePath,
    });
    expect(trail.groups[0]!.header.vcs).toBeDefined();
    expect(trail.groups[0]!.header.vcs?.type).toBe("git");
    expect(trail.groups[0]!.header.vcs?.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(trail.groups[0]!.header.vcs?.remote_url).toBe(
      "https://github.com/agent-trail/agent-trail",
    );
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("parseSession() leaves vcs undefined when cwd is not a git working tree", async () => {
  const trail = await parseFixture();
  expect(trail.groups[0]!.header.vcs).toBeUndefined();
});

// Issue #88: lifecycle vocabulary mapping. Each progress hookEvent routes to a
// reserved system_event.kind so cross-agent analysis can rely on the enum.
// Issue #88: system envelope subtypes map to reserved kinds where portable
// (stop_hook_summary → turn_end) and to x-claudecode/* otherwise.
// Issue #88: queue-operation envelopes lack uuid across Claude Code versions
// (null or absent). The adapter synthesizes a UUID and stamps source.synthesized.
test("parseSession() maps ai-title and agent-name to session_metadata_update events", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "cc-aititle-"));
  try {
    const fixturePath = join(tmp, "session.jsonl");
    const lines = [
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "hi" },
        uuid: "00000000-0000-0000-0000-000000000040",
        timestamp: "2026-05-17T22:00:00.000Z",
        sessionId: "s",
        version: "v",
      }),
      JSON.stringify({ type: "ai-title", aiTitle: "Wire ai-title plumbing", sessionId: "s" }),
      JSON.stringify({ type: "agent-name", agentName: "wire-ai-title-plumbing", sessionId: "s" }),
    ].join("\n");
    writeFileSync(fixturePath, `${lines}\n`);
    const trail = await claudeCodeAdapter.parseSession({
      id: "s",
      adapter: "claude-code",
      path: fixturePath,
    });
    expect(trail.envelope?.name).toBeUndefined();
    expect(trail.envelope?.meta).toBeUndefined();
    const updates = trail.groups[0]!.entries.filter(
      (entry) => entry.type === "session_metadata_update",
    );
    expect(updates.map((entry) => entry.payload)).toEqual([
      { field: "name", value: "Wire ai-title plumbing", reason: "ai_generated" },
      {
        field: "x-claudecode/agent_name",
        value: "wire-ai-title-plumbing",
        reason: "ai_generated",
      },
    ]);
    expect(updates.map((entry) => entry.ts)).toEqual([
      "2026-05-17T22:00:00.000Z",
      "2026-05-17T22:00:00.000Z",
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("parseSession() maps agent-name without ai-title to a vendor session_metadata_update", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "cc-agentname-"));
  try {
    const fixturePath = join(tmp, "session.jsonl");
    const lines = [
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "hi" },
        uuid: "00000000-0000-0000-0000-000000000041",
        timestamp: "2026-05-17T22:00:00.000Z",
        sessionId: "s",
        version: "v",
      }),
      JSON.stringify({ type: "agent-name", agentName: "fallback-slug", sessionId: "s" }),
    ].join("\n");
    writeFileSync(fixturePath, `${lines}\n`);
    const trail = await claudeCodeAdapter.parseSession({
      id: "s",
      adapter: "claude-code",
      path: fixturePath,
    });
    expect(trail.envelope?.name).toBeUndefined();
    expect(trail.envelope?.meta).toBeUndefined();
    const update = trail.groups[0]!.entries.find(
      (entry) =>
        entry.type === "session_metadata_update" &&
        entry.payload?.field === "x-claudecode/agent_name",
    );
    expect(update?.payload).toEqual({
      field: "x-claudecode/agent_name",
      value: "fallback-slug",
      reason: "ai_generated",
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("parseSession() maps worktree-state to session_metadata_update when cwd is unreadable", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "cc-worktree-"));
  try {
    const fixturePath = join(tmp, "session.jsonl");
    const lines = [
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "hi" },
        uuid: "00000000-0000-0000-0000-000000000050",
        timestamp: "2026-05-17T22:00:00.000Z",
        sessionId: "s",
        version: "v",
        cwd: "/this/path/does/not/exist",
      }),
      JSON.stringify({
        type: "worktree-state",
        sessionId: "s",
        worktreeSession: {
          originalCwd: "/orig/repo",
          worktreePath: "/orig/repo/.worktrees/topic",
          worktreeName: "topic",
          worktreeBranch: "feature/topic",
          originalBranch: "main",
          originalHeadCommit: "abcdef0123456789abcdef0123456789abcdef01",
          sessionId: "s",
        },
      }),
    ].join("\n");
    writeFileSync(fixturePath, `${lines}\n`);
    const trail = await claudeCodeAdapter.parseSession({
      id: "s",
      adapter: "claude-code",
      path: fixturePath,
    });
    expect(trail.groups[0]!.header.vcs).toBeUndefined();
    const updates = trail.groups[0]!.entries.filter(
      (entry) => entry.type === "session_metadata_update",
    ).map((entry) => entry.payload);
    expect(updates).toEqual([
      { field: "vcs.branch", value: "feature/topic", reason: "runtime_inferred" },
      {
        field: "vcs.worktree",
        value: {
          name: "topic",
          path: "/orig/repo/.worktrees/topic",
          original_cwd: "/orig/repo",
          original_branch: "main",
          original_head_commit: "abcdef0123456789abcdef0123456789abcdef01",
        },
        reason: "runtime_inferred",
      },
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Issue #88: permission-mode envelopes synthesize a system_event with kind
// permission_mode_change. Timestamp inherited from prior envelope, prev mode
// surfaces under data.from on subsequent transitions.
test("parseSession() emits permission_mode_change with inherited timestamp + from/to data", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmp = mkdtempSync(join(tmpdir(), "cc-perm-"));
  try {
    const fixturePath = join(tmp, "session.jsonl");
    const lines = [
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "hi" },
        uuid: "00000000-0000-0000-0000-000000000060",
        timestamp: "2026-05-17T22:00:00.000Z",
        sessionId: "s",
        version: "v",
      }),
      JSON.stringify({ type: "permission-mode", permissionMode: "plan", sessionId: "s" }),
      JSON.stringify({
        parentUuid: "00000000-0000-0000-0000-000000000060",
        isSidechain: false,
        type: "user",
        message: { role: "user", content: "next" },
        uuid: "00000000-0000-0000-0000-000000000061",
        timestamp: "2026-05-17T22:00:05.000Z",
        sessionId: "s",
        version: "v",
      }),
      JSON.stringify({
        type: "permission-mode",
        permissionMode: "bypassPermissions",
        sessionId: "s",
      }),
    ].join("\n");
    writeFileSync(fixturePath, `${lines}\n`);
    const trail = await claudeCodeAdapter.parseSession({
      id: "s",
      adapter: "claude-code",
      path: fixturePath,
    });
    const pmEvents = trail.groups[0]!.entries.filter(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "permission_mode_change",
    );
    expect(pmEvents).toHaveLength(2);
    const first = pmEvents[0];
    const second = pmEvents[1];
    expect(first?.ts).toBe("2026-05-17T22:00:00.000Z");
    expect((first?.payload as { data?: { to?: string; from?: string } }).data).toEqual({
      to: "plan",
    });
    expect(first?.source?.synthesized).toBe(true);
    expect(second?.ts).toBe("2026-05-17T22:00:05.000Z");
    expect((second?.payload as { data?: { to?: string; from?: string } }).data).toEqual({
      to: "bypassPermissions",
      from: "plan",
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Issue #88: pr-link envelopes lack uuid; adapter synthesizes id and surfaces
// pr metadata under payload.data.
// Issue #88: synthesized entry ids (queue-operation, pr-link, permission-mode)
// must be deterministic — re-parsing the same JSONL must yield the same ids
// so downstream tooling can dedupe across re-parses.
