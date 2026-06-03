import { expect, test } from "bun:test";
import type {
  AgentTrailV010,
  CapabilityChange,
  Header,
  ModeChange,
  ModelChange,
  SessionMetadataUpdate,
  SystemEvent,
  ThinkingLevelChange,
} from "@agent-trail/types";

test("@agent-trail/types exposes generated schema types", () => {
  const header = {
    type: "session",
    schema_version: "0.1.0",
    id: "sess_0001",
    ts: "2026-05-19T00:00:00.000Z",
    agent: {
      name: "codex-cli",
    },
  } satisfies Header;

  const record: AgentTrailV010 = header;

  expect(record.type).toBe("session");
});

// Regression: SystemEvent.payload.kind must accept both reserved values and
// adapter-namespaced `x-<adapter>/<name>` extensions. The pre-fix generator
// output (`(reserved | { [k: string]: unknown }) & string`) silently rejected
// extension kinds because the index-signature branch collapsed to `never`.
test("SystemEvent.payload.kind accepts reserved + x-<adapter>/<name> extensions", () => {
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

  expect(change.payload.scope).toBe("tool");
  expect(change.payload.snapshot[0]?.metadata?.namespace).toBe("web");
  expect(change.payload.changed[0]?.field).toBe("description");
});

test("setting change types accept reserved + x-<adapter>/<name> extensions", () => {
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

test("SessionMetadataUpdate exposes reserved and x-<adapter>/<name> field shapes", () => {
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
