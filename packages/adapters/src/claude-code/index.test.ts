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

test("claudeCodeAdapter parseSession emits a trail envelope", async () => {
  const trail = await parseFixture();
  expect(trail.envelope).toBeDefined();
  expect(trail.envelope?.type).toBe("trail");
  expect(trail.envelope?.schema_version).toBe("0.1.0");
  expect(trail.envelope?.producer).toMatch(/^@agent-trail\/adapters-claude-code\//);
  expect(typeof trail.envelope?.id).toBe("string");
  expect(typeof trail.envelope?.ts).toBe("string");
  expect(trail.envelope?.id).not.toBe(trail.header.id);
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
  const { session_uid, ...header } = trail.header;
  expect(typeof session_uid).toBe("string");
  expect(session_uid).toMatch(
    /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/,
  );
  expect(header).toEqual({
    type: "session",
    schema_version: "0.1.0",
    id: "00000000-0000-0000-0000-ccccc0000001",
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
  const userMessage = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-cccccccccc11");
  expect(userMessage).toBeDefined();
  expect(userMessage?.type).toBe("user_message");
  expect(userMessage?.ts).toBe("2026-05-17T14:00:05.000Z");
  expect(userMessage?.payload).toEqual({ text: "please list the files" });
  expect(userMessage?.parent_id).toBeUndefined();
  expect(userMessage?.source?.original_type).toBe("user");
});

test("parseSession() emits a tool_call for assistant tool_use blocks, with semantic.call_id preserving tool_use_id", async () => {
  const trail = await parseFixture();
  const toolCall = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-cccccccccc12");
  expect(toolCall).toBeDefined();
  expect(toolCall?.type).toBe("tool_call");
  expect(toolCall?.parent_id).toBe("00000000-0000-0000-0000-cccccccccc11");
  expect(toolCall?.payload).toEqual({
    tool: "shell_command",
    args: { command: "ls" },
  });
  expect(toolCall?.semantic).toEqual({ call_id: "tooluse-1", tool_kind: "shell_command" });
});

test("parseSession() emits a tool_result for user tool_result blocks linked back to the tool_call event id", async () => {
  const trail = await parseFixture();
  const toolResult = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-cccccccccc13");
  expect(toolResult).toBeDefined();
  expect(toolResult?.type).toBe("tool_result");
  expect(toolResult?.parent_id).toBe("00000000-0000-0000-0000-cccccccccc12");
  expect(toolResult?.payload).toEqual({
    for_id: "00000000-0000-0000-0000-cccccccccc12",
    ok: true,
    output: "file-a\nfile-b",
  });
  expect(toolResult?.semantic).toEqual({ call_id: "tooluse-1", tool_kind: "shell_command" });
});

test("parseSession() emits an agent_message for assistant text records with model", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-cccccccccc14");
  expect(agentMsg).toBeDefined();
  expect(agentMsg?.type).toBe("agent_message");
  expect(agentMsg?.parent_id).toBe("00000000-0000-0000-0000-cccccccccc13");
  expect(agentMsg?.payload).toEqual({
    text: "two files: file-a, file-b",
    model: "claude-opus-4-7",
    stop_reason: "end_turn",
    usage: {
      input_tokens: 18,
      output_tokens: 12,
    },
  });
});

test("parseSession() maps cache_read_input_tokens and cache_creation_input_tokens to cache_read_tokens and cache_creation_tokens", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "00000000-0000-0000-0000-1d5344910296",
      timestamp: "2026-05-17T22:00:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-1d5344910296",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 1234,
          output_tokens: 567,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 50,
          service_tier: "standard",
        },
      },
      uuid: "00000000-0000-0000-0000-d223468611b6",
      timestamp: "2026-05-17T22:00:01.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const agentMsg = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-d223468611b6");
  expect(agentMsg?.type).toBe("agent_message");
  expect((agentMsg?.payload as Record<string, unknown>)?.usage).toEqual({
    input_tokens: 1234,
    output_tokens: 567,
    cache_read_tokens: 100,
    cache_creation_tokens: 50,
  });
});

test("parseSession() drops usage when assistant envelope has only tool_use blocks (no text)", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "00000000-0000-0000-0000-74f66820e99d",
      timestamp: "2026-05-17T22:20:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-74f66820e99d",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "tool_use", id: "tooluse-only", name: "Bash", input: { command: "ls" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      uuid: "00000000-0000-0000-0000-86a305e93511",
      timestamp: "2026-05-17T22:20:01.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  // No agent_message entries emitted from this envelope; usage is discarded.
  expect(trail.entries.filter((e) => e.type === "agent_message")).toHaveLength(0);
  const toolCall = trail.entries.find((e) => e.type === "tool_call");
  expect(toolCall?.payload).not.toHaveProperty("usage");
});

test("parseSession() omits payload.usage when source provides no usage data", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "00000000-0000-0000-0000-b4e31f5675a3",
      timestamp: "2026-05-17T22:10:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-b4e31f5675a3",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "hi back" }],
        stop_reason: "end_turn",
      },
      uuid: "00000000-0000-0000-0000-8e45abbc959e",
      timestamp: "2026-05-17T22:10:01.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const agentMsg = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-8e45abbc959e");
  expect(agentMsg?.payload).not.toHaveProperty("usage");
});

test("parseSession() emits a session_summary for summary records", async () => {
  const trail = await parseFixture();
  const summary = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-cccccccccc15");
  expect(summary).toBeDefined();
  expect(summary?.type).toBe("session_summary");
  expect(summary?.parent_id).toBe("00000000-0000-0000-0000-cccccccccc14");
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
      uuid: "00000000-0000-0000-0000-a24a7f55f278",
      timestamp: "2026-05-17T14:00:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-a24a7f55f278",
      isSidechain: false,
      type: "attachment",
      uuid: "00000000-0000-0000-0000-20864c4631c6",
      timestamp: "2026-05-17T14:00:02.000Z",
      sessionId: "s",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-20864c4631c6",
      isSidechain: false,
      type: "file-history-snapshot",
      uuid: "00000000-0000-0000-0000-9f2460b56367",
      timestamp: "2026-05-17T14:00:03.000Z",
      sessionId: "s",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-9f2460b56367",
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "second" },
      uuid: "00000000-0000-0000-0000-1fe2696cbaaf",
      timestamp: "2026-05-17T14:00:04.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const u2 = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-1fe2696cbaaf");
  expect(u2?.parent_id).toBe("00000000-0000-0000-0000-a24a7f55f278");
});

test("parseSession() emits user_interrupt for string content '[Request interrupted by user]' with reason 'user'", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: { role: "user", content: "[Request interrupted by user]" },
    uuid: "00000000-0000-0000-0000-db6ac7323733",
    timestamp: "2026-05-17T18:00:00.000Z",
    sessionId: "s",
    version: "v",
  })}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const entry = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-db6ac7323733");
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
    uuid: "00000000-0000-0000-0000-8d0b403631a1",
    timestamp: "2026-05-17T18:00:01.000Z",
    sessionId: "s",
    version: "v",
  })}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const entry = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-8d0b403631a1");
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
    uuid: "00000000-0000-0000-0000-1e67a787d253",
    timestamp: "2026-05-17T18:00:02.000Z",
    sessionId: "s",
    version: "v",
  })}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const entry = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-1e67a787d253");
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
      uuid: "00000000-0000-0000-0000-37ee04e08f54",
      timestamp: "2026-05-17T19:00:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-37ee04e08f54",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "first reply" }],
        stop_reason: "end_turn",
      },
      uuid: "00000000-0000-0000-0000-58d78559af06",
      timestamp: "2026-05-17T19:00:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-58d78559af06",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "second reply" }],
        stop_reason: "end_turn",
      },
      uuid: "00000000-0000-0000-0000-03dfb10884d1",
      timestamp: "2026-05-17T19:00:02.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const modelChange = trail.entries.find((e) => e.type === "model_change");
  expect(modelChange).toBeDefined();
  expect(modelChange?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  expect(modelChange?.ts).toBe("2026-05-17T19:00:02.000Z");
  expect(modelChange?.payload).toEqual({
    from_model: "claude-opus-4-7",
    to_model: "claude-sonnet-4-5",
  });
  expect(modelChange?.parent_id).toBe("00000000-0000-0000-0000-58d78559af06");
});

test("parseSession() does not emit model_change when consecutive assistant envelopes share the same model", async () => {
  const { parseClaudeCodeJsonl } = await import("./parser.ts");
  const text = `${[
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "00000000-0000-0000-0000-c79fdb1fd66b",
      timestamp: "2026-05-17T19:01:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-c79fdb1fd66b",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "00000000-0000-0000-0000-9132b281303c",
      timestamp: "2026-05-17T19:01:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-9132b281303c",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "two" }],
      },
      uuid: "00000000-0000-0000-0000-62def5597eaf",
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
      uuid: "00000000-0000-0000-0000-e7535eef58ea",
      timestamp: "2026-05-17T19:02:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-e7535eef58ea",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "00000000-0000-0000-0000-e85cb2d828ec",
      timestamp: "2026-05-17T19:02:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-e85cb2d828ec",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "two" }],
      },
      uuid: "00000000-0000-0000-0000-53486fd8f3d0",
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
      uuid: "00000000-0000-0000-0000-f272dc649c16",
      timestamp: "2026-05-17T19:03:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-f272dc649c16",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "00000000-0000-0000-0000-f255c4f8a0c1",
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
      uuid: "00000000-0000-0000-0000-f16c2f53a0c9",
      timestamp: "2026-05-17T20:00:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    mkAssistant(
      "u-bf-1",
      "00000000-0000-0000-0000-f16c2f53a0c9",
      "claude-opus-4-7",
      "2026-05-17T20:00:01.000Z",
    ),
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
      uuid: "00000000-0000-0000-0000-bc8b0b6e8f1e",
      timestamp: "2026-05-17T20:10:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    mkAssistant(
      "u-3m-1",
      "00000000-0000-0000-0000-bc8b0b6e8f1e",
      "claude-opus-4-7",
      "2026-05-17T20:10:01.000Z",
    ),
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
      uuid: "00000000-0000-0000-0000-08ea6db7713d",
      timestamp: "2026-05-17T20:20:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-08ea6db7713d",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "00000000-0000-0000-0000-d18fd025dcc9",
      timestamp: "2026-05-17T20:20:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-d18fd025dcc9",
      isSidechain: false,
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "no-model" }] },
      uuid: "00000000-0000-0000-0000-5d2c43766d2c",
      timestamp: "2026-05-17T20:20:02.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-5d2c43766d2c",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "two" }],
      },
      uuid: "00000000-0000-0000-0000-476b27563514",
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
      uuid: "00000000-0000-0000-0000-c8feeb8026f3",
      timestamp: "2026-05-17T21:00:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-c8feeb8026f3",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "00000000-0000-0000-0000-2956eef5170f",
      timestamp: "2026-05-17T21:00:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-2956eef5170f",
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
      uuid: "00000000-0000-0000-0000-3ec3494d045f",
      timestamp: "2026-05-17T21:10:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-3ec3494d045f",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "00000000-0000-0000-0000-4e9eb3ebf18d",
      timestamp: "2026-05-17T21:10:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    // Sonnet envelope dropped: missing timestamp -> buildEntries returns [].
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-4e9eb3ebf18d",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "lost" }],
      },
      uuid: "00000000-0000-0000-0000-0e9103efa0f6",
      sessionId: "s",
      version: "v",
    }),
    // Next opus envelope must NOT emit a model_change because sonnet was never visible.
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-0e9103efa0f6",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "three" }],
      },
      uuid: "00000000-0000-0000-0000-855d660e5686",
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
      uuid: "00000000-0000-0000-0000-21341a1eb2c2",
      timestamp: "2026-05-17T21:20:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-21341a1eb2c2",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "text", text: "one" }],
      },
      uuid: "00000000-0000-0000-0000-d56f9fd9310b",
      timestamp: "2026-05-17T21:20:01.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-d56f9fd9310b",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "two" }],
      },
      uuid: "00000000-0000-0000-0000-50b6774c89e0",
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
      uuid: "00000000-0000-0000-0000-dd737d1f4015",
      timestamp: "2026-05-17T19:04:00.000Z",
      sessionId: "s",
      version: "v",
    }),
    JSON.stringify({
      parentUuid: "00000000-0000-0000-0000-dd737d1f4015",
      isSidechain: false,
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-7",
        content: [{ type: "thinking", thinking: "", signature: "synthetic-sig-token" }],
      },
      uuid: "00000000-0000-0000-0000-d73659702ebf",
      timestamp: "2026-05-17T19:04:01.000Z",
      sessionId: "s",
      version: "v",
    }),
  ].join("\n")}\n`;
  const trail = parseClaudeCodeJsonl(text);
  const thinking = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-d73659702ebf");
  expect(thinking?.type).toBe("agent_thinking");
  expect(thinking?.payload).toEqual({ text: "", model: "claude-opus-4-7" });
});

test("parseSession() filters attachment, sidechain, and isMeta records", async () => {
  const trail = await parseFixture();
  expect(trail.entries).toHaveLength(5);
  const ids = trail.entries.map((e) => e.id);
  expect(ids).not.toContain("00000000-0000-0000-0000-ccccccccaa11");
  expect(ids).not.toContain("00000000-0000-0000-0000-ccccccccdc11");
  expect(ids).not.toContain("00000000-0000-0000-0000-cccccccceee1");
});

test("parseSession() fans out mixed assistant blocks and multiple tool calls in source order", async () => {
  const trail = await parseFidelityFixture();
  // Multi-block envelopes mint fresh UUIDs per block (see entry-metadata.ts);
  // assert source order + types instead of specific compound id strings. Block
  // call_ids preserved via semantic.call_id remain stable across runs.
  const types = trail.entries.slice(0, 6).map((e) => e.type);
  expect(types).toEqual([
    "user_message",
    "agent_message",
    "agent_thinking",
    "agent_thinking",
    "tool_call",
    "tool_call",
  ]);

  const text = trail.entries[1];
  expect(text?.type).toBe("agent_message");
  expect(text?.parent_id).toBe("00000000-0000-0000-0000-aaaaaaaaaa11");

  const thinking = trail.entries[2];
  expect(thinking?.type).toBe("agent_thinking");
  expect(thinking?.parent_id).toBe(text?.id);

  const read = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-read",
  );
  expect(read).toBeDefined();
  expect(read?.payload).toEqual({ tool: "file_read", args: { path: "package.json" } });
  expect(read?.semantic).toEqual({ call_id: "tooluse-read", tool_kind: "file_read" });

  const bash = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-bash",
  );
  expect(bash).toBeDefined();
  expect(bash?.payload).toEqual({ tool: "shell_command", args: { command: "bun run check" } });
  expect(bash?.parent_id).toBe(read?.id);
});

test("parseSession() emits multiple tool_results with error state and semantic pairing", async () => {
  const trail = await parseFidelityFixture();
  // tool_call and tool_result block ids are fresh UUIDs at runtime, but the
  // tool_call's id is preserved as for_id on the paired tool_result. Pair by
  // semantic.call_id and verify the for_id linkage.
  const readCall = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-read",
  );
  const readResult = trail.entries.find(
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

  const bashCall = trail.entries.find(
    (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-bash",
  );
  const bashResult = trail.entries.find(
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
  expect(
    trail.entries.find((e) => e.id === "00000000-0000-0000-0000-aaaaaaaaaa14")?.payload,
  ).toEqual({
    kind: "system",
    text: "<command-name>/model</command-name>",
  });
  expect(
    trail.entries.find((e) => e.id === "00000000-0000-0000-0000-aaaaaaaaaa15")?.payload,
  ).toEqual({
    kind: "hook_progress",
    text: "Hook progress: PreToolUse (PreToolUse:Bash)",
    data: { type: "hook_progress", hookEvent: "PreToolUse", hookName: "PreToolUse:Bash" },
  });
  expect(
    trail.entries.find((e) => e.id === "00000000-0000-0000-0000-aaaaaaaaaa16")?.payload,
  ).toEqual({
    kind: "queue_operation",
    text: "Queued input: queued follow-up while tool is running",
  });
  expect(trail.entries.find((e) => e.id === "00000000-0000-0000-0000-aaaaaaaaaa17")?.type).toBe(
    "system_event",
  );
  expect(trail.entries.find((e) => e.id === "00000000-0000-0000-0000-aaaaaaaaaa18")?.type).toBe(
    "session_summary",
  );
  expect(trail.entries.find((e) => e.id === "00000000-0000-0000-0000-aaaaaaaaaa19")?.type).toBe(
    "context_compact",
  );
});

test("interrupt-and-model-change fixture: emits user_interrupt and synthetic model_change in expected sequence", async () => {
  const trail = await parseInterruptModelFixture();
  // Synthesized model_change id is a fresh UUID at runtime; assert the
  // sequence by type so the random id doesn't break the test.
  const types = trail.entries.map((e) => e.type);
  expect(types).toEqual([
    "user_message",
    "agent_message",
    "user_interrupt",
    "user_message",
    "model_change",
    "agent_message",
    "agent_message",
  ]);

  const interrupt = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-111111111113");
  expect(interrupt?.type).toBe("user_interrupt");
  expect(interrupt?.payload).toEqual({ reason: "user for tool use" });
  expect(interrupt?.parent_id).toBe("00000000-0000-0000-0000-111111111112");

  const modelChange = trail.entries.find((e) => e.type === "model_change");
  expect(modelChange?.type).toBe("model_change");
  expect(modelChange?.payload).toEqual({
    from_model: "claude-opus-4-7",
    to_model: "claude-sonnet-4-5",
  });
  expect(modelChange?.source?.synthesized).toBe(true);
  expect(modelChange?.parent_id).toBe("00000000-0000-0000-0000-111111111114");

  const sonnetMsg = trail.entries.find((e) => e.id === "00000000-0000-0000-0000-111111111115");
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
  expect(bytes).toBeLessThan(13_000);
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
      uuid: "00000000-0000-0000-0000-5c5bd01a113b",
      parentUuid: null,
      timestamp: "2026-05-21T16:00:01.000Z",
      type: "user",
      sessionId: "sess-eref",
      message: { role: "user", content: "go" },
    }),
    JSON.stringify({
      uuid: "00000000-0000-0000-0000-25889ee230bc",
      parentUuid: "00000000-0000-0000-0000-5c5bd01a113b",
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
  // Block ids are fresh UUIDs at runtime. The dedup contract is positional:
  // the first block-derived entry inlines its source.raw.envelope, and later
  // block-derived entries reference back to it via source.raw.envelope_ref.
  const assistantBlocks = trail.entries.filter((e) =>
    ["agent_message", "agent_thinking", "tool_call"].includes(e.type),
  );
  expect(assistantBlocks.length).toBe(3);
  const first = assistantBlocks[0];
  const firstRaw = first?.source?.raw as Record<string, unknown>;
  expect(firstRaw.envelope).toBeDefined();
  expect(firstRaw.envelope_ref).toBeUndefined();
  for (const later of assistantBlocks.slice(1)) {
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

test("parseSession() populates vcs.remote_url from header.cwd when cwd is a git working tree with an origin remote", async () => {
  const repoDir = mkdtempSync(join(tmpdir(), "cc-vcs-repo-"));
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
