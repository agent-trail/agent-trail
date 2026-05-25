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

const FIXTURE_PATH = new URL("../../tests/fixtures/claude-code/basic-flow.jsonl", import.meta.url)
  .pathname;
const FIDELITY_FIXTURE_PATH = new URL(
  "../../tests/fixtures/claude-code/fidelity-edge-cases.jsonl",
  import.meta.url,
).pathname;
const INTERRUPT_MODEL_FIXTURE_PATH = new URL(
  "../../tests/fixtures/claude-code/interrupt-and-model-change.jsonl",
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

async function parseInterruptModelFixture() {
  return claudeCodeAdapter.parseSession({
    id: "interrupt-and-model-change",
    adapter: "claude-code",
    path: INTERRUPT_MODEL_FIXTURE_PATH,
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

test("parseSession() emits user_interrupt for string content '[Request interrupted by user]' with reason 'user'", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: { role: "user", content: "[Request interrupted by user]" },
    uuid: "u-int-1",
    timestamp: "2026-05-17T18:00:00.000Z",
    sessionId: "s",
    version: "v",
  })}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const entry = trail.entries.find((e) => e.id === "u-int-1");
  expect(entry?.type).toBe("user_interrupt");
  expect(entry?.payload).toEqual({ reason: "user" });
});

test("parseSession() extracts reason 'user for tool use' from '[Request interrupted by user for tool use]'", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: { role: "user", content: "[Request interrupted by user for tool use]" },
    uuid: "u-int-2",
    timestamp: "2026-05-17T18:00:01.000Z",
    sessionId: "s",
    version: "v",
  })}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const entry = trail.entries.find((e) => e.id === "u-int-2");
  expect(entry?.type).toBe("user_interrupt");
  expect(entry?.payload).toEqual({ reason: "user for tool use" });
});

test("parseSession() emits user_interrupt for text block '[Request interrupted by user]' in array content", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: "[Request interrupted by user for tool use]" }],
    },
    uuid: "u-int-3",
    timestamp: "2026-05-17T18:00:02.000Z",
    sessionId: "s",
    version: "v",
  })}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const entry = trail.entries.find((e) => e.id === "u-int-3");
  expect(entry?.type).toBe("user_interrupt");
  expect(entry?.payload).toEqual({ reason: "user for tool use" });
});

test("parseSession() emits model_change when assistant model shifts from claude-opus-4-7 to claude-sonnet-4-5", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-mc-1",
      timestamp: "2026-05-17T19:00:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-mc-1",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "first reply" }],
        stop_reason: "end_turn",
      },
      uuid: "u-mc-2",
      timestamp: "2026-05-17T19:00:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-mc-2",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "second reply" }],
        stop_reason: "end_turn",
      },
      uuid: "u-mc-3",
      timestamp: "2026-05-17T19:00:02.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const modelChange = trail.entries.find((e) => e.type === "model_change");
  expect(modelChange).toBeDefined();
  expect(modelChange?.id).toBe("u-mc-3-model_change");
  expect(modelChange?.ts).toBe("2026-05-17T19:00:02.000Z");
  expect(modelChange?.payload).toEqual({
    from_model: "claude-opus-4-7",
    to_model: "claude-sonnet-4-5",
  });
  expect(modelChange?.parent_id).toBe("u-mc-2");
});

test("parseSession() does not emit model_change when consecutive assistant envelopes share the same model", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-mc-a",
      timestamp: "2026-05-17T19:01:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-mc-a",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "u-mc-b",
      timestamp: "2026-05-17T19:01:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-mc-b",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "two" }],
      },
      uuid: "u-mc-c",
      timestamp: "2026-05-17T19:01:02.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  expect(trail.entries.filter((e) => e.type === "model_change")).toHaveLength(0);
});

test("parseSession() marks the model_change entry with source.synthesized = true", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-syn-1",
      timestamp: "2026-05-17T19:02:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-syn-1",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "u-syn-2",
      timestamp: "2026-05-17T19:02:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-syn-2",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "two" }],
      },
      uuid: "u-syn-3",
      timestamp: "2026-05-17T19:02:02.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const modelChange = trail.entries.find((e) => e.type === "model_change");
  expect(modelChange?.source?.synthesized).toBe(true);
});

test("parseSession() does not emit model_change for the first assistant envelope", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-fm-1",
      timestamp: "2026-05-17T19:03:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-fm-1",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "u-fm-2",
      timestamp: "2026-05-17T19:03:01.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  expect(trail.entries.filter((e) => e.type === "model_change")).toHaveLength(0);
});

test("parseSession() emits one model_change per shift across opus -> sonnet -> opus", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const mkAssistant = (uuid: string, parent: string, model: string, ts: string) =>
    JSON.stringify({
      parentUuid: parent,
      isSidechain: false,
      type: "assistant",
      message: { role: "assistant", model, content: [{ type: "text", text: "x" }] },
      uuid,
      timestamp: ts,
      sessionId: "s",
      version: "v",
    });
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-bf-0",
      timestamp: "2026-05-17T20:00:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    mkAssistant("u-bf-1", "u-bf-0", "claude-opus-4-7", "2026-05-17T20:00:01.000Z"),
    mkAssistant("u-bf-2", "u-bf-1", "claude-sonnet-4-5", "2026-05-17T20:00:02.000Z"),
    mkAssistant("u-bf-3", "u-bf-2", "claude-opus-4-7", "2026-05-17T20:00:03.000Z"),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const changes = trail.entries.filter((e) => e.type === "model_change");
  expect(changes).toHaveLength(2);
  expect(changes[0]?.payload).toEqual({
    from_model: "claude-opus-4-7",
    to_model: "claude-sonnet-4-5",
  });
  expect(changes[1]?.payload).toEqual({
    from_model: "claude-sonnet-4-5",
    to_model: "claude-opus-4-7",
  });
});

test("parseSession() emits model_change for three distinct models in sequence", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const mkAssistant = (uuid: string, parent: string, model: string, ts: string) =>
    JSON.stringify({
      parentUuid: parent,
      isSidechain: false,
      type: "assistant",
      message: { role: "assistant", model, content: [{ type: "text", text: "x" }] },
      uuid,
      timestamp: ts,
      sessionId: "s",
      version: "v",
    });
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-3m-0",
      timestamp: "2026-05-17T20:10:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    mkAssistant("u-3m-1", "u-3m-0", "claude-opus-4-7", "2026-05-17T20:10:01.000Z"),
    mkAssistant("u-3m-2", "u-3m-1", "claude-sonnet-4-5", "2026-05-17T20:10:02.000Z"),
    mkAssistant("u-3m-3", "u-3m-2", "claude-haiku-4-5", "2026-05-17T20:10:03.000Z"),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const changes = trail.entries.filter((e) => e.type === "model_change");
  expect(changes.map((c) => c.payload)).toEqual([
    { from_model: "claude-opus-4-7", to_model: "claude-sonnet-4-5" },
    { from_model: "claude-sonnet-4-5", to_model: "claude-haiku-4-5" },
  ]);
});

test("parseSession() does not update prevModel for assistant envelopes missing message.model", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-nm-0",
      timestamp: "2026-05-17T20:20:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-nm-0",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "u-nm-1",
      timestamp: "2026-05-17T20:20:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-nm-1",
      isSidechain: false,
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "no-model" }] },
      uuid: "u-nm-2",
      timestamp: "2026-05-17T20:20:02.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-nm-2",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "two" }],
      },
      uuid: "u-nm-3",
      timestamp: "2026-05-17T20:20:03.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const changes = trail.entries.filter((e) => e.type === "model_change");
  expect(changes).toHaveLength(1);
  expect(changes[0]?.payload).toEqual({
    from_model: "claude-opus-4-7",
    to_model: "claude-sonnet-4-5",
  });
});

test("parseSession() does not throw or emit model_change when an assistant envelope is missing uuid mid-shift", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-no-1",
      timestamp: "2026-05-17T21:00:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-no-1",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "u-no-2",
      timestamp: "2026-05-17T21:00:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-no-2",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "two" }],
      },
      // uuid intentionally missing
      timestamp: "2026-05-17T21:00:02.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  expect(() => parseClaudeCodeJsonl(text)).not.toThrow();
  const trail = parseClaudeCodeJsonl(text);
  expect(trail.entries.filter((e) => e.type === "model_change")).toHaveLength(0);
});

test("parseSession() does not advance prevModel when an assistant envelope produces no entries (e.g. missing timestamp)", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-pv-0",
      timestamp: "2026-05-17T21:10:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-pv-0",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "u-pv-1",
      timestamp: "2026-05-17T21:10:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    // Sonnet envelope dropped: missing timestamp -> buildEntries returns [].
    JSON.stringify({
      parentUuid: "u-pv-1",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "lost" }],
      },
      uuid: "u-pv-2",
      sessionId: "s",
      version: "v",
    }),
    // Next opus envelope must NOT emit a model_change because sonnet was never visible.
    JSON.stringify({
      parentUuid: "u-pv-2",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "three" }],
      },
      uuid: "u-pv-3",
      timestamp: "2026-05-17T21:10:03.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  expect(trail.entries.filter((e) => e.type === "model_change")).toHaveLength(0);
});

test("parseSession() records the synthesized model_change with source.original_type = 'assistant'", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-ot-0",
      timestamp: "2026-05-17T21:20:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-ot-0",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "u-ot-1",
      timestamp: "2026-05-17T21:20:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-ot-1",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "two" }],
      },
      uuid: "u-ot-2",
      timestamp: "2026-05-17T21:20:02.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const modelChange = trail.entries.find((e) => e.type === "model_change");
  expect(modelChange?.source?.original_type).toBe("assistant");
});

test("parseSession() emits agent_thinking for a thinking block with empty text but a signature", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u-sig-1",
      timestamp: "2026-05-17T19:04:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "u-sig-1",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "thinking", thinking: "", signature: "synthetic-sig-token" }],
      },
      uuid: "u-sig-2",
      timestamp: "2026-05-17T19:04:01.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const thinking = trail.entries.find((e) => e.id === "u-sig-2");
  expect(thinking?.type).toBe("agent_thinking");
  expect(thinking?.payload).toEqual({ text: "", model: "claude-opus-4-7" });
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

test("interrupt-and-model-change fixture: emits user_interrupt and synthetic model_change in expected sequence", async () => {
  const trail = await parseInterruptModelFixture();
  const ids = trail.entries.map((e) => e.id);
  expect(ids).toEqual([
    "cc-int-1",
    "cc-int-2",
    "cc-int-3",
    "cc-int-4",
    "cc-int-5-model_change",
    "cc-int-5",
    "cc-int-6",
  ]);

  const interrupt = trail.entries.find((e) => e.id === "cc-int-3");
  expect(interrupt?.type).toBe("user_interrupt");
  expect(interrupt?.payload).toEqual({ reason: "user for tool use" });
  expect(interrupt?.parent_id).toBe("cc-int-2");

  const modelChange = trail.entries.find((e) => e.id === "cc-int-5-model_change");
  expect(modelChange?.type).toBe("model_change");
  expect(modelChange?.payload).toEqual({
    from_model: "claude-opus-4-7",
    to_model: "claude-sonnet-4-5",
  });
  expect(modelChange?.source?.synthesized).toBe(true);
  expect(modelChange?.parent_id).toBe("cc-int-4");

  const sonnetMsg = trail.entries.find((e) => e.id === "cc-int-5");
  expect(sonnetMsg?.type).toBe("agent_message");

  expect(trail.entries.filter((e) => e.type === "model_change")).toHaveLength(1);
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

test("every entry has source metadata: agent='claude-code', original_type populated, schema_version set, raw preserved", async () => {
  const trail = await parseFixture();
  for (const entry of trail.entries) {
    expect(entry.source?.agent).toBe("claude-code");
    expect(typeof entry.source?.original_type).toBe("string");
    expect(entry.source?.schema_version).toBe("1.0.0-synthetic");
    expect(entry.source?.raw).toBeDefined();
  }
});

test("fidelity-edge-cases trail output drops below 11 KB after envelope_ref dedup", async () => {
  // Before envelope_ref dedup this fixture serialized to ~15.1 KB; the bound
  // documents the floor after dedup (~10.1 KB at writing) without locking the
  // exact byte count.
  const trail = await parseFidelityFixture();
  const lines = [JSON.stringify(trail.header), ...trail.entries.map((e) => JSON.stringify(e))];
  const bytes = Buffer.byteLength(`${lines.join("\n")}\n`, "utf8");
  expect(bytes).toBeLessThan(11_000);
});

test("block-derived entries from the same assistant envelope dedup via envelope_ref", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      sessionId: "sess-eref",
      version: "1.0.0",
      type: "session",
      timestamp: "2026-05-21T16:00:00.000Z",
      cwd: "/tmp/synthetic",
    }),
    JSON.stringify({
      uuid: "u-eref-1",
      parentUuid: null,
      timestamp: "2026-05-21T16:00:01.000Z",
      type: "user",
      sessionId: "sess-eref",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      uuid: "a-eref-1",
      parentUuid: "u-eref-1",
      timestamp: "2026-05-21T16:00:02.000Z",
      type: "assistant",
      sessionId: "sess-eref",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
          { type: "tool_use", id: "tu-1", name: "Read", input: { file_path: "/x" } },
        ],
      },
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const first = trail.entries.find((e) => e.id === "a-eref-1-text-0");
  const second = trail.entries.find((e) => e.id === "a-eref-1-text-1");
  const toolCall = trail.entries.find((e) => e.id === "a-eref-1-tool_use-2");
  const firstRaw = first?.source?.raw as Record<string, unknown>;
  expect(firstRaw.envelope).toBeDefined();
  expect(firstRaw.envelope_ref).toBeUndefined();
  for (const later of [second, toolCall]) {
    const raw = later?.source?.raw as Record<string, unknown>;
    expect(raw.envelope_ref).toBe(first?.id);
    expect(raw.envelope).toBeUndefined();
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
