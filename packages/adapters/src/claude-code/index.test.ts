import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter, validateAdapterTrail } from "../index.ts";
import { ID_PATTERN } from "../test-helpers.ts";
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
const PERMISSION_MODE_FIXTURE_PATH = new URL(
  "../../tests/fixtures/claude-code/permission-mode.jsonl",
  import.meta.url,
).pathname;
const CAPABILITY_CHANGES_FIXTURE_PATH = new URL(
  "../../tests/fixtures/claude-code/capability-changes.jsonl",
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

async function parsePermissionModeFixture() {
  return claudeCodeAdapter.parseSession({
    id: "permission-mode",
    adapter: "claude-code",
    path: PERMISSION_MODE_FIXTURE_PATH,
  });
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
  const userMessage = trail.entries.find((e) => e.type === "user_message");
  expect(userMessage).toBeDefined();
  expect(userMessage?.ts).toBe("2026-05-17T14:00:05.000Z");
  expect(userMessage?.payload).toEqual({ text: "please list the files" });
  // The leading user record has no parentUuid → root of the linear chain.
  expect(userMessage?.parent_id).toBeNull();
  expect(userMessage?.source?.original_type).toBe("user");
});

test("parseSession() emits a tool_call for assistant tool_use blocks, with semantic.call_id preserving tool_use_id", async () => {
  const trail = await parseFixture();
  const idx = trail.entries.findIndex((e) => e.type === "tool_call");
  const toolCall = trail.entries[idx];
  expect(toolCall).toBeDefined();
  // Claude Code is a linear sequential chain — each entry parents off the entry
  // emitted immediately before it (here, the interposing queue system_event).
  expect(toolCall?.parent_id).toBe(trail.entries[idx - 1]?.id);
  expect(toolCall?.payload).toEqual({
    tool: "shell_command",
    args: { command: "ls" },
  });
  expect(toolCall?.semantic).toEqual({ call_id: "tooluse-1", tool_kind: "shell_command" });
});

test("parseSession() emits a tool_result for user tool_result blocks linked back to the tool_call event id", async () => {
  const trail = await parseFixture();
  const toolCall = trail.entries.find((e) => e.type === "tool_call");
  const toolResult = trail.entries.find((e) => e.type === "tool_result");
  expect(toolResult).toBeDefined();
  expect(toolResult?.parent_id).toBe(toolCall?.id);
  expect(toolResult?.payload).toEqual({
    for_id: toolCall?.id,
    ok: true,
    output: "file-a\nfile-b",
  });
  expect(toolResult?.semantic).toEqual({ call_id: "tooluse-1", tool_kind: "shell_command" });
});

test("parseSession() emits an agent_message for assistant text records with model", async () => {
  const trail = await parseFixture();
  const toolResult = trail.entries.find((e) => e.type === "tool_result");
  const agentMsg = trail.entries.find((e) => e.type === "agent_message");
  expect(agentMsg).toBeDefined();
  expect(agentMsg?.parent_id).toBe(toolResult?.id);
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

test("parseSession() emits a session_summary for summary records", async () => {
  const trail = await parseFixture();
  const agentMsg = trail.entries.find((e) => e.type === "agent_message");
  const summary = trail.entries.find((e) => e.type === "session_summary");
  expect(summary).toBeDefined();
  expect(summary?.parent_id).toBe(agentMsg?.id);
  expect(summary?.payload).toEqual({
    scope: "session",
    text: "listed files in working directory",
  });
});

test("parseSession() filters attachment, sidechain, and isMeta records", async () => {
  const trail = await parseFixture();
  // 5 message-derived entries + 1 system_event for the synthetic queue-operation
  // (issue #88 now emits queue-operation envelopes with synthesized ids).
  expect(trail.entries).toHaveLength(6);
  const ids = trail.entries.map((e) => e.id);
  expect(ids).not.toContain("00000000-0000-0000-0000-ccccccccaa11");
  expect(ids).not.toContain("00000000-0000-0000-0000-ccccccccdc11");
  expect(ids).not.toContain("00000000-0000-0000-0000-cccccccceee1");
});

test("parseSession() maps Claude Code capability attachment deltas", async () => {
  const trail = await parseCapabilityChangesFixture();
  const changes = trail.entries.filter((entry) => entry.type === "capability_change");
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
  // The first agent block chains off the leading user_message (entries[0]).
  expect(text?.parent_id).toBe(trail.entries[0]?.id);

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

test("toolKindAndArgs promotes common Claude tools out of other", () => {
  expect(toolKindAndArgs("ToolSearch", { query: "auth flow" })).toEqual({
    tool: "tool_search",
    args: { query: "auth flow" },
  });
  expect(
    toolKindAndArgs("AskUserQuestion", { question: "Which backend?", choices: ["bun"] }),
  ).toEqual({
    tool: "user_input_request",
    args: { question: "Which backend?", choices: ["bun"] },
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

test("AskUserQuestion result preserves answer under tool_result meta", async () => {
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
              input: { question: "Ship?", choices: ["yes", "no"] },
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
            { type: "tool_result", tool_use_id: "tooluse-question", content: "yes, ship it" },
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
    const call = trail.entries.find(
      (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-question",
    );
    const result = trail.entries.find(
      (e) => e.type === "tool_result" && e.semantic?.call_id === "tooluse-question",
    );
    if (call === undefined || result === undefined) throw new Error("expected paired tool entries");

    expect(result.payload).toEqual({
      for_id: call.id,
      ok: true,
      output: "yes, ship it",
      meta: { user_input_request: { answers: "yes, ship it" } },
    });
    const diagnostics = await validateAdapterTrail(trail);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("AskUserQuestion result does not mirror oversized answers into meta", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cc-user-input-answer-large-"));
  const path = join(tmp, "session.jsonl");
  try {
    const sessionId = "00000000-0000-0000-0000-ccccc0000200";
    const largeAnswer = "🙂".repeat(3_000);
    expect(largeAnswer.length).toBeLessThan(10_240);
    expect(new TextEncoder().encode(largeAnswer).byteLength).toBeGreaterThan(10_240);
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
          content: [
            { type: "tool_result", tool_use_id: "tooluse-question-large", content: largeAnswer },
          ],
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
    const call = trail.entries.find(
      (e) => e.type === "tool_call" && e.semantic?.call_id === "tooluse-question-large",
    );
    const result = trail.entries.find(
      (e) => e.type === "tool_result" && e.semantic?.call_id === "tooluse-question-large",
    );
    if (call === undefined || result === undefined) throw new Error("expected paired tool entries");

    expect(result.payload).toEqual({
      for_id: call.id,
      ok: true,
      output: largeAnswer,
    });
    expect(result.semantic?.tool_kind).toBe("user_input_request");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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
  const byKind = (kind: string) =>
    trail.entries.find((e) => (e.payload as { kind?: string })?.kind === kind);
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
  expect(trail.entries.some((e) => e.type === "session_summary")).toBe(true);
  expect(trail.entries.some((e) => e.type === "context_compact")).toBe(true);
});

test("parseSession() emits v0.1-shaped deterministic entry ids across synthesized-entry fixtures", async () => {
  const first = await parseFixture();
  const second = await parseFixture();
  expect(first.entries.map((e) => e.id)).toEqual(second.entries.map((e) => e.id));
  for (const entry of first.entries) expect(entry.id).toMatch(ID_PATTERN);
  expect(
    first.entries.some(
      (e) =>
        e.type === "system_event" && (e.payload as { kind?: string }).kind === "queue_operation",
    ),
  ).toBe(true);

  const model = await parseInterruptModelFixture();
  const modelAgain = await parseInterruptModelFixture();
  expect(model.entries.map((e) => e.id)).toEqual(modelAgain.entries.map((e) => e.id));
  for (const entry of model.entries) expect(entry.id).toMatch(ID_PATTERN);
  expect(model.entries.some((e) => e.type === "model_change")).toBe(true);

  const permission = await parsePermissionModeFixture();
  const permissionAgain = await parsePermissionModeFixture();
  expect(permission.entries.map((e) => e.id)).toEqual(permissionAgain.entries.map((e) => e.id));
  for (const entry of permission.entries) expect(entry.id).toMatch(ID_PATTERN);
  expect(
    permission.entries.some(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "permission_mode_change",
    ),
  ).toBe(true);
});

test("interrupt-and-model-change fixture: emits user_interrupt and synthetic model_change in expected sequence", async () => {
  const trail = await parseInterruptModelFixture();
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

  // Indices follow the sequence asserted above; assert linkage via those entries'
  // own ids rather than reconstructing the kit's internal id scheme.
  const interrupt = trail.entries[2];
  expect(interrupt?.type).toBe("user_interrupt");
  expect(interrupt?.payload).toEqual({ reason: "user for tool use" });
  expect(interrupt?.parent_id).toBe(trail.entries[1]?.id);

  const modelChange = trail.entries.find((e) => e.type === "model_change");
  expect(modelChange?.type).toBe("model_change");
  expect(modelChange?.payload).toEqual({
    from_model: "claude-opus-4-7",
    to_model: "claude-sonnet-4-5",
  });
  expect(modelChange?.source?.synthesized).toBe(true);
  // model_change is synthesized before the second user_message's agent reply;
  // its parent is the preceding user_message (entries[3]).
  expect(modelChange?.parent_id).toBe(trail.entries[3]?.id);

  const sonnetMsg = trail.entries[5];
  expect(sonnetMsg?.type).toBe("agent_message");
  expect(sonnetMsg?.parent_id).toBe(modelChange?.id);

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
    const quarantine = trail.entries.find(
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
  for (const entry of trail.entries) {
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
  const lines = [JSON.stringify(trail.header), ...trail.entries.map((e) => JSON.stringify(e))];
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

// Issue #88: lifecycle vocabulary mapping. Each progress hookEvent routes to a
// reserved system_event.kind so cross-agent analysis can rely on the enum.
// Issue #88: system envelope subtypes map to reserved kinds where portable
// (stop_hook_summary → turn_end) and to x-claudecode/* otherwise.
// Issue #88: queue-operation envelopes lack uuid across Claude Code versions
// (null or absent). The adapter synthesizes a UUID and stamps source.synthesized.
// Issue #88: ai-title envelope populates envelope.name + meta breadcrumb.
test("parseSession() surfaces ai-title under envelope.name and envelope.meta", async () => {
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
    expect(trail.envelope?.name).toBe("Wire ai-title plumbing");
    expect(trail.envelope?.meta).toEqual({
      "x-claudecode/ai_title": "Wire ai-title plumbing",
      "x-claudecode/agent_name": "wire-ai-title-plumbing",
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Issue #88: agent-name alone (no ai-title) still populates envelope.name.
test("parseSession() falls back to agent-name when ai-title is absent", async () => {
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
    expect(trail.envelope?.name).toBe("fallback-slug");
    expect(trail.envelope?.meta).toEqual({ "x-claudecode/agent_name": "fallback-slug" });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Issue #88: worktree-state populates vcs.branch + vcs.head_commit + vcs.worktree.
// Falls back to envelope-supplied head_commit when the worktree directory is no
// longer readable (paseo-style ephemeral worktrees).
test("parseSession() populates vcs.worktree from worktree-state envelope when cwd is unreadable", async () => {
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
    expect(trail.header.vcs?.type).toBe("git");
    expect(trail.header.vcs?.branch).toBe("feature/topic");
    expect(trail.header.vcs?.head_commit).toBe("abcdef0123456789abcdef0123456789abcdef01");
    expect(trail.header.vcs?.worktree).toEqual({
      name: "topic",
      path: "/orig/repo/.worktrees/topic",
      original_cwd: "/orig/repo",
      original_branch: "main",
      original_head_commit: "abcdef0123456789abcdef0123456789abcdef01",
    });
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
    const pmEvents = trail.entries.filter(
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
