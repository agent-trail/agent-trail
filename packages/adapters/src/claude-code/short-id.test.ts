import { expect, test } from "bun:test";
import { validateAdapterTrail } from "../index.ts";
import { parseClaudeCodeJsonl } from "./parser.ts";

// v0.1 #/$defs/id pattern: ULID-26 | UUID-36 | UUID-32hex.
const ID_PATTERN =
  /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/;

const SESSION_ID = "00000000-0000-0000-0000-bbbb00000001";

function jsonl(...records: Array<Record<string, unknown>>): string {
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

function userMsg(uuid: string, parentUuid: string | null, text: string): Record<string, unknown> {
  return {
    type: "user",
    uuid,
    parentUuid,
    timestamp: "2026-05-21T14:00:01.000Z",
    sessionId: SESSION_ID,
    cwd: "/tmp/p",
    version: "1.0.0",
    message: { role: "user", content: text },
  };
}

function assistantTextMsg(
  uuid: string,
  parentUuid: string | null,
  text: string,
): Record<string, unknown> {
  return {
    type: "assistant",
    uuid,
    parentUuid,
    timestamp: "2026-05-21T14:00:02.000Z",
    sessionId: SESSION_ID,
    cwd: "/tmp/p",
    version: "1.0.0",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
    },
  };
}

test("cc adapter emits v0.1-conforming entry ids for 8-char hex source uuids", async () => {
  const text = jsonl(
    userMsg("bfc8efd4", null, "hi"),
    assistantTextMsg("3e956835", "bfc8efd4", "hello"),
  );
  const trail = parseClaudeCodeJsonl(text);
  expect(trail.entries.length).toBeGreaterThan(0);
  for (const entry of trail.entries) {
    expect(entry.id).toMatch(ID_PATTERN);
  }
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("cc adapter is deterministic: re-parsing the same JSONL yields identical entry ids", () => {
  const text = jsonl(
    userMsg("bfc8efd4", null, "hi"),
    assistantTextMsg("3e956835", "bfc8efd4", "hello"),
  );
  const a = parseClaudeCodeJsonl(text).entries.map((e) => e.id);
  const b = parseClaudeCodeJsonl(text).entries.map((e) => e.id);
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThan(0);
});

test("cc adapter translates parentUuid chain: emitted parent_id points to previous emitted entry", () => {
  const text = jsonl(
    userMsg("bfc8efd4", null, "hi"),
    assistantTextMsg("3e956835", "bfc8efd4", "hello"),
  );
  const trail = parseClaudeCodeJsonl(text);
  const [first, second] = trail.entries;
  if (first === undefined || second === undefined) throw new Error("expected two entries");
  expect(second.parent_id).toBe(first.id);
  expect(first.id).toMatch(ID_PATTERN);
  expect(second.id).toMatch(ID_PATTERN);
});

test("cc adapter mints deterministic uuid-shaped ids for multi-block assistant envelopes", () => {
  const multiBlockEnv: Record<string, unknown> = {
    type: "assistant",
    uuid: "3e956835",
    parentUuid: "bfc8efd4",
    timestamp: "2026-05-21T14:00:02.000Z",
    sessionId: SESSION_ID,
    cwd: "/tmp/p",
    version: "1.0.0",
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5",
      content: [
        { type: "text", text: "thinking aloud" },
        {
          type: "tool_use",
          id: "00000000-0000-0000-0000-ccccdddd0001",
          name: "Read",
          input: { file_path: "x" },
        },
      ],
      stop_reason: "tool_use",
    },
  };
  const text = jsonl(userMsg("bfc8efd4", null, "hi"), multiBlockEnv);
  const trail = parseClaudeCodeJsonl(text);
  const blocks = trail.entries.filter((e) => e.type === "agent_message" || e.type === "tool_call");
  expect(blocks.length).toBe(2);
  const ids = blocks.map((e) => e.id);
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) expect(id).toMatch(ID_PATTERN);
  const trailB = parseClaudeCodeJsonl(text);
  const idsB = trailB.entries
    .filter((e) => e.type === "agent_message" || e.type === "tool_call")
    .map((e) => e.id);
  expect(idsB).toEqual(ids);
});

test("cc adapter synthesizes deterministic uuid for queue-operation system_event (no source uuid)", () => {
  const queueEnv: Record<string, unknown> = {
    type: "queue-operation",
    operation: "enqueue",
    content: "background task",
    timestamp: "2026-05-21T14:00:03.000Z",
    sessionId: SESSION_ID,
    cwd: "/tmp/p",
    version: "1.0.0",
  };
  const text = jsonl(userMsg("bfc8efd4", null, "hi"), queueEnv);
  const trail = parseClaudeCodeJsonl(text);
  const sysEvent = trail.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind?: string } | undefined)?.kind === "queue_operation",
  );
  expect(sysEvent).toBeDefined();
  expect(sysEvent?.id).toMatch(ID_PATTERN);
  const trailB = parseClaudeCodeJsonl(text);
  const sysEventB = trailB.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind?: string } | undefined)?.kind === "queue_operation",
  );
  expect(sysEventB?.id).toBe(sysEvent?.id);
});

test("cc adapter synthesizes deterministic uuid for permission-mode system_event (no source uuid)", () => {
  const permEnv: Record<string, unknown> = {
    type: "permission-mode",
    permissionMode: "acceptEdits",
    sessionId: SESSION_ID,
    cwd: "/tmp/p",
    version: "1.0.0",
  };
  const text = jsonl(userMsg("bfc8efd4", null, "hi"), permEnv);
  const trail = parseClaudeCodeJsonl(text);
  const sysEvent = trail.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind?: string } | undefined)?.kind === "permission_mode_change",
  );
  expect(sysEvent).toBeDefined();
  expect(sysEvent?.id).toMatch(ID_PATTERN);
  const trailB = parseClaudeCodeJsonl(text);
  const sysEventB = trailB.entries.find(
    (e) =>
      e.type === "system_event" &&
      (e.payload as { kind?: string } | undefined)?.kind === "permission_mode_change",
  );
  expect(sysEventB?.id).toBe(sysEvent?.id);
});

test("cc adapter preserves original short source uuid under source.raw", () => {
  const text = jsonl(userMsg("bfc8efd4", null, "hi"));
  const trail = parseClaudeCodeJsonl(text);
  const user = trail.entries.find((e) => e.type === "user_message");
  expect(user).toBeDefined();
  const raw = user?.source?.raw as Record<string, unknown> | undefined;
  expect(raw?.uuid).toBe("bfc8efd4");
});
