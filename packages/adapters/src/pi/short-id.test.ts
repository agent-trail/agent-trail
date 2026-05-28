import { expect, test } from "bun:test";
import { validateAdapterTrail } from "../index.ts";
import { parsePiJsonl } from "./parser.ts";

// v0.1 #/$defs/id pattern: ULID-26 | UUID-36 | UUID-32hex.
const ID_PATTERN =
  /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/;

const SESSION_ID = "00000000-0000-0000-0000-aaaa00000001";

function jsonl(...records: Array<Record<string, unknown>>): string {
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

function header(): Record<string, unknown> {
  return {
    type: "session",
    version: 3,
    id: SESSION_ID,
    timestamp: "2026-05-21T14:00:00.000Z",
    cwd: "/tmp/p",
  };
}

function userMsg(id: string, parentId: string | null, text: string): Record<string, unknown> {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-05-21T14:00:01.000Z",
    message: { role: "user", content: text },
  };
}

function assistantTextMsg(
  id: string,
  parentId: string | null,
  text: string,
): Record<string, unknown> {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-05-21T14:00:02.000Z",
    message: {
      role: "assistant",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      stopReason: "stop",
      content: [{ type: "text", text }],
    },
  };
}

test("Pi adapter emits v0.1-conforming entry ids for 8-char hex source ids", async () => {
  const text = jsonl(
    header(),
    userMsg("3e956835", null, "hi"),
    assistantTextMsg("9a1f2b00", "3e956835", "hello"),
  );

  const trail = parsePiJsonl(text);

  expect(trail.entries.length).toBeGreaterThan(0);
  for (const entry of trail.entries) {
    expect(entry.id).toMatch(ID_PATTERN);
  }
  const diagnostics = await validateAdapterTrail(trail);
  const errors = diagnostics.filter((d) => d.severity === "error");
  expect(errors).toEqual([]);
});

test("Pi adapter is deterministic: re-parsing the same JSONL yields identical entry ids", () => {
  const text = jsonl(
    header(),
    userMsg("3e956835", null, "hi"),
    assistantTextMsg("9a1f2b00", "3e956835", "hello"),
  );
  const a = parsePiJsonl(text).entries.map((e) => e.id);
  const b = parsePiJsonl(text).entries.map((e) => e.id);
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThan(0);
});

test("Pi adapter translates parentId chain: emitted parent_id points to previous emitted entry", () => {
  const text = jsonl(
    header(),
    userMsg("3e956835", null, "hi"),
    assistantTextMsg("9a1f2b00", "3e956835", "hello"),
  );
  const trail = parsePiJsonl(text);
  const [first, second] = trail.entries;
  if (first === undefined || second === undefined) throw new Error("expected two entries");
  expect(second.parent_id).toBe(first.id);
  expect(first.id).toMatch(ID_PATTERN);
  expect(second.id).toMatch(ID_PATTERN);
});

test("Pi adapter mints deterministic uuid-shaped ids for multi-block assistant envelopes", () => {
  const multiBlockEnv: Record<string, unknown> = {
    type: "message",
    id: "9a1f2b00",
    parentId: "3e956835",
    timestamp: "2026-05-21T14:00:02.000Z",
    message: {
      role: "assistant",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "thinking aloud" },
        {
          type: "toolCall",
          id: "00000000-0000-0000-0000-ccccdddd0001",
          name: "read",
          arguments: { path: "x" },
        },
      ],
    },
  };
  const text = jsonl(header(), userMsg("3e956835", null, "hi"), multiBlockEnv);
  const trail = parsePiJsonl(text);
  const blocks = trail.entries.filter((e) => e.id !== trail.entries[0]?.id);
  // 2 emittable blocks → 2 entries from the assistant envelope.
  const assistantBlocks = trail.entries.filter(
    (e) => e.type === "agent_message" || e.type === "tool_call",
  );
  expect(assistantBlocks.length).toBe(2);
  const ids = assistantBlocks.map((e) => e.id);
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) expect(id).toMatch(ID_PATTERN);
  // Re-parse → same block ids.
  const trailB = parsePiJsonl(text);
  const idsB = trailB.entries
    .filter((e) => e.type === "agent_message" || e.type === "tool_call")
    .map((e) => e.id);
  expect(idsB).toEqual(ids);
  // Avoid unused warning for `blocks`.
  expect(blocks.length).toBeGreaterThan(0);
});

test("Pi adapter synthesizes deterministic uuid for aborted assistant user_interrupt", () => {
  const abortedEnv: Record<string, unknown> = {
    type: "message",
    id: "9a1f2b00",
    parentId: "3e956835",
    timestamp: "2026-05-21T14:00:02.000Z",
    message: {
      role: "assistant",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      stopReason: "aborted",
      content: "partial answer",
    },
  };
  const text = jsonl(header(), userMsg("3e956835", null, "hi"), abortedEnv);
  const trail = parsePiJsonl(text);
  const interrupt = trail.entries.find((e) => e.type === "user_interrupt");
  expect(interrupt).toBeDefined();
  expect(interrupt?.id).toMatch(ID_PATTERN);
  const trailB = parsePiJsonl(text);
  expect(trailB.entries.find((e) => e.type === "user_interrupt")?.id).toBe(interrupt?.id);
});

test("Pi adapter synthesizes deterministic uuid for session_terminated on unmatched tool_call EOF", () => {
  const toolCallEnv: Record<string, unknown> = {
    type: "message",
    id: "9a1f2b00",
    parentId: "3e956835",
    timestamp: "2026-05-21T14:00:02.000Z",
    message: {
      role: "assistant",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "00000000-0000-0000-0000-ccccdddd0001",
          name: "read",
          arguments: { path: "x" },
        },
      ],
    },
  };
  const text = jsonl(header(), userMsg("3e956835", null, "hi"), toolCallEnv);
  const trail = parsePiJsonl(text);
  const terminated = trail.entries.find((e) => e.type === "session_terminated");
  expect(terminated).toBeDefined();
  expect(terminated?.id).toMatch(ID_PATTERN);
  const trailB = parsePiJsonl(text);
  expect(trailB.entries.find((e) => e.type === "session_terminated")?.id).toBe(terminated?.id);
});

test("Pi adapter preserves original short source id under source.raw", () => {
  const text = jsonl(header(), userMsg("3e956835", null, "hi"));
  const trail = parsePiJsonl(text);
  const user = trail.entries.find((e) => e.type === "user_message");
  expect(user).toBeDefined();
  // Inline-raw path: raw is the envelope itself; the original short id sits at raw.id.
  const raw = user?.source?.raw as Record<string, unknown> | undefined;
  expect(raw?.id).toBe("3e956835");
});
