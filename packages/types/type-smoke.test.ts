import { expect, test } from "bun:test";
import type {
  AgentMessageUsage,
  AgentName,
  AgentTrailV010,
  CapabilityChange,
  Header,
  ModeChange,
  ModelChange,
  SessionMetadataUpdate,
  SystemEvent,
  ThinkingLevelChange,
  ToolCallAborted,
  UserMessage,
  Vcs,
} from "@agent-trail/types";

test("@agent-trail/types exposes generated schema types", () => {
  const header = {
    type: "session",
    schema_version: "0.1.0",
    id: "sess_0001",
    name: "Initial title",
    description: "Initial description",
    tags: ["release", "docs"],
    ts: "2026-05-19T00:00:00.000Z",
    agent: {
      name: "codex-cli",
    },
  } satisfies Header;

  const record: AgentTrailV010 = header;

  expect(record.type).toBe("session");
  expect(header.name).toBe("Initial title");
  expect(header.description).toBe("Initial description");
  expect(header.tags).toEqual(["release", "docs"]);
});

test("AgentName accepts registry names and slashed custom names", () => {
  const registered = "codex-cli" satisfies AgentName;
  const extension = "x-example/myagent" satisfies AgentName;
  const extensionWithUnderscore = "x-example/my_agent" satisfies AgentName;
  // @ts-expect-error legacy hyphenated custom agent names must not satisfy AgentName.
  const invalidLegacy = "x-com-example-myagent" satisfies AgentName;
  // @ts-expect-error custom agent vendor segment must be lowercase.
  const invalidUppercaseVendor = "x-Example/myagent" satisfies AgentName;
  // @ts-expect-error custom agent name segment must be lowercase.
  const invalidUppercaseName = "x-example/Myagent" satisfies AgentName;

  expect(registered).toBe("codex-cli");
  expect(extension).toBe("x-example/myagent");
  expect(extensionWithUnderscore).toBe("x-example/my_agent");
  expect(invalidLegacy).toBe("x-com-example-myagent");
  expect(invalidUppercaseVendor).toBe("x-Example/myagent");
  expect(invalidUppercaseName).toBe("x-example/Myagent");
});

test("Vcs.type accepts reserved and extension values", () => {
  const reserved = {
    type: "git",
    revision: "abcdef0",
  } satisfies Vcs;
  const extension = {
    type: "x-acme/fossil",
    revision: "abc123",
  } satisfies Vcs;
  const unborn = {
    type: "git",
    revision: null,
    branch: "main",
  } satisfies Vcs;
  const invalidUnbornHeadCommit = {
    type: "git",
    revision: null,
    branch: "main",
    head_commit: "abcdef0",
  };
  // @ts-expect-error writer schema rejects head_commit when revision is null.
  const invalidUnbornHeadCommitCheck: Vcs = invalidUnbornHeadCommit;
  const bare = {
    // @ts-expect-error writer schema rejects bare unknown VCS types.
    type: "fossil",
    revision: "abc123",
  } satisfies Vcs;

  expect(reserved.type).toBe("git");
  expect(extension.type).toBe("x-acme/fossil");
  expect(unborn.revision).toBe(null);
  expect(invalidUnbornHeadCommitCheck.head_commit).toBe("abcdef0");
  expect(invalidUnbornHeadCommit.head_commit).toBe("abcdef0");
  expect(bare.type).toBe("fossil");
});

test("AgentMessageUsage accepts input/output or total coverage and rejects extra fields", () => {
  const delta = {
    input_tokens: 1,
    output_tokens: 2,
  } satisfies AgentMessageUsage;
  const cumulative = {
    input_tokens_cumulative: 10,
    output_tokens_cumulative: 20,
    context_window_tokens: 200000,
  } satisfies AgentMessageUsage;
  const total = {
    total_tokens: 30,
  } satisfies AgentMessageUsage;
  const totalCumulative = {
    total_tokens_cumulative: 40,
  } satisfies AgentMessageUsage;

  // @ts-expect-error writer schema rejects extra usage fields.
  const extra = { input_tokens: 1, output_tokens: 2, cost_usd: 0.01 } satisfies AgentMessageUsage;
  // @ts-expect-error writer schema requires output or total coverage when usage is present.
  const missingOutput = { input_tokens: 1 } satisfies AgentMessageUsage;
  // @ts-expect-error writer schema requires input or total coverage when usage is present.
  const missingInput = { output_tokens: 2 } satisfies AgentMessageUsage;

  expect(delta.input_tokens).toBe(1);
  expect(cumulative.output_tokens_cumulative).toBe(20);
  expect(total.total_tokens).toBe(30);
  expect(totalCumulative.total_tokens_cumulative).toBe(40);
  expect(extra.cost_usd).toBe(0.01);
  expect(missingOutput.input_tokens).toBe(1);
  expect(missingInput.output_tokens).toBe(2);
});

// Regression: SystemEvent.payload.kind must accept both reserved values and
// vendor-namespaced `x-<vendor>/<name>` extensions. The pre-fix generator
// output (`(reserved | { [k: string]: unknown }) & string`) silently rejected
// extension kinds because the index-signature branch collapsed to `never`.
test("SystemEvent.payload.kind accepts reserved + x-<vendor>/<name> extensions", () => {
  const reserved = {
    type: "system_event",
    payload: { kind: "heartbeat" },
  } satisfies SystemEvent;
  const extension = {
    type: "system_event",
    payload: { kind: "x-claudecode/diag" },
  } satisfies SystemEvent;
  const another = {
    type: "system_event",
    payload: { kind: "x-pi/custom_message" },
  } satisfies SystemEvent;
  expect(reserved.payload?.kind).toBe("heartbeat");
  expect(extension.payload?.kind).toBe("x-claudecode/diag");
  expect(another.payload?.kind).toBe("x-pi/custom_message");
});

test("UserMessage.payload.origin accepts reserved + x-<vendor>/<name> extensions", () => {
  const reserved = {
    type: "user_message",
    payload: { text: "hello", origin: "injected" },
  } satisfies UserMessage;
  const extension = {
    type: "user_message",
    payload: { text: "pasted context", origin: "x-acme/paste" },
  } satisfies UserMessage;
  const bareUnknownPayload: NonNullable<UserMessage["payload"]> = {
    text: "bot text",
    // @ts-expect-error writer schema rejects bare unknown origins.
    origin: "bot",
  };

  expect(reserved.payload?.origin).toBe("injected");
  expect(extension.payload?.origin).toBe("x-acme/paste");
  expect(String(bareUnknownPayload.origin)).toBe("bot");
});

test("CapabilityChange exposes scope, reason, and typed item shapes", () => {
  const change = {
    type: "capability_change",
    payload: {
      scope: "tool",
      reason: "loaded",
      snapshot: [
        {
          name: "search_web",
          metadata: { namespace: "web" },
        },
      ],
      changed: [{ name: "search_web", field: "description", to: "Search" }],
    },
  } satisfies CapabilityChange;
  // @ts-expect-error writer schema requires at least one change array.
  const missingChangeArrayPayload: NonNullable<CapabilityChange["payload"]> = {
    scope: "tool",
    reason: "registered",
  };
  const extraPayloadKey: NonNullable<CapabilityChange["payload"]> = {
    scope: "tool",
    reason: "registered",
    added: [{ name: "search_web" }],
    // @ts-expect-error writer schema rejects extra capability_change payload keys.
    unexpected: true,
  };

  expect(change.payload.scope).toBe("tool");
  expect(change.payload.snapshot[0]?.metadata?.namespace).toBe("web");
  expect(change.payload.changed[0]?.field).toBe("description");
  expect(missingChangeArrayPayload.scope).toBe("tool");
  expect((extraPayloadKey as Record<string, unknown>).unexpected).toBe(true);
});

test("setting change types accept reserved + x-<vendor>/<name> extensions", () => {
  const model = {
    type: "model_change",
    payload: { to_model: "gpt-5", trigger: "x-codex/model_picker" },
  } satisfies ModelChange;
  const mode = {
    type: "mode_change",
    payload: {
      scope: "x-codex/local_mode",
      to_mode: "fast",
      trigger: "x-codex/user_toggle",
    },
  } satisfies ModeChange;
  const thinking = {
    type: "thinking_level_change",
    payload: { to_level: "high", trigger: "x-codex/reasoning_effort" },
  } satisfies ThinkingLevelChange;

  expect(model.payload?.trigger).toBe("x-codex/model_picker");
  expect(mode.payload?.scope).toBe("x-codex/local_mode");
  expect(thinking.payload?.trigger).toBe("x-codex/reasoning_effort");
});

test("SessionMetadataUpdate exposes reserved and x-<vendor>/<name> field shapes", () => {
  const name = {
    type: "session_metadata_update",
    payload: { field: "name", value: "Release notes", reason: "ai_generated" },
  } satisfies SessionMetadataUpdate;
  const tags = {
    type: "session_metadata_update",
    payload: { field: "tags", value: ["release"], reason: "user_set" },
  } satisfies SessionMetadataUpdate;
  const worktree = {
    type: "session_metadata_update",
    payload: {
      field: "vcs.worktree",
      value: { name: "topic", path: "/repo/.worktrees/topic" },
      reason: "runtime_inferred",
    },
  } satisfies SessionMetadataUpdate;
  const vendor = {
    type: "session_metadata_update",
    payload: {
      field: "x-codex/thread_goal",
      value: { summary: null, items: ["ship"] },
      reason: "ai_generated",
    },
  } satisfies SessionMetadataUpdate;

  expect(name.payload?.field).toBe("name");
  expect(tags.payload?.field).toBe("tags");
  expect(worktree.payload?.field).toBe("vcs.worktree");
  expect(vendor.payload?.field).toBe("x-codex/thread_goal");
});

test("ToolCallAborted exposes reserved and x-<vendor>/<name> reason/scope shapes", () => {
  const reserved = {
    type: "tool_call_aborted",
    payload: {
      scope: "tool_call",
      reason: "hook_blocked",
      for_id: "call1",
      blocked_by: "PreToolUse:Bash",
    },
  } satisfies ToolCallAborted;
  const extension = {
    type: "tool_call_aborted",
    payload: {
      scope: "x-codex/turn_scope",
      reason: "x-codex/interrupted",
    },
  } satisfies ToolCallAborted;
  // @ts-expect-error call-scoped aborts must carry for_id.
  const missingForIdPayload: NonNullable<ToolCallAborted["payload"]> = {
    scope: "tool_call",
    reason: "hook_blocked",
  };
  // @ts-expect-error non-call-scoped aborts must not carry for_id.
  const turnWithForIdPayload: NonNullable<ToolCallAborted["payload"]> = {
    scope: "turn",
    reason: "user_interrupt",
    for_id: "call1",
  };

  expect(reserved.payload?.reason).toBe("hook_blocked");
  expect(extension.payload?.scope).toBe("x-codex/turn_scope");
  expect(missingForIdPayload.reason).toBe("hook_blocked");
  expect(turnWithForIdPayload.scope).toBe("turn");
});
