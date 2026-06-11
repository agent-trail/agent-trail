import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { codexAdapter } from "./index.ts";
import { parseCodexEntries, parseCodexSnapshotEntries } from "./kit.ts";
import { codexUserQueryResponses } from "./reconcile-rules.ts";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/codex");
const entries = (fixture: string): Promise<Entry[]> =>
  parseCodexEntries(join(FIXTURES, fixture), "unit-test");

const thinkingTexts = (es: Entry[]): string[] =>
  es.filter((e) => e.type === "agent_thinking").map((e) => normalize(String(e.payload.text)));

const normalize = (t: string) => t.replace(/\s+/g, " ").trim();

const baseSession = {
  timestamp: "2026-05-28T00:00:00.000Z",
  type: "session_meta",
  payload: { id: "00000000-0000-4000-8000-000000000001", timestamp: "2026-05-28T00:00:00.000Z" },
};

describe("codex v2 stateful behaviors", () => {
  test("user_query_response preserves linker-derived call_id", () => {
    const out = codexUserQueryResponses(
      [
        {
          type: "user_query",
          id: "query-1",
          ts: "2026-05-18T10:00:00.000Z",
          payload: { questions: [{ id: "ship", question: "Ship?" }] },
          meta: { linker: { call_id: "call-user-input" } },
        },
        {
          type: "tool_result",
          id: "result-1",
          ts: "2026-05-18T10:00:01.000Z",
          payload: { ok: true, output: '{"answers":{"ship":"yes"}}' },
          meta: { linker: { call_id: "call-user-input" } },
        },
      ] as Entry[],
      { agent: "codex-cli" },
    );

    expect(out[1]?.type).toBe("user_query_response");
    expect(out[1]?.semantic).toEqual({ call_id: "call-user-input" });
  });

  // The harness is a multiset, so un-deduped duplicates would pass as
  // non-blocking additions — assert the count + uniqueness directly, tied to v1.
  test("reasoning dedup: per-turn duplicates collapse (matches v1 count)", async () => {
    const path = join(FIXTURES, "reasoning-dedupe.jsonl");
    const v1 = (await codexAdapter.parseSession({ id: "x", adapter: "codex", path })).groups[0]!
      .entries;
    const keys = thinkingTexts(await entries("reasoning-dedupe.jsonl"));
    // No two emitted thinking entries share a normalized key (dedup held)...
    expect(new Set(keys).size).toBe(keys.length);
    // ...and the emitted count exactly matches v1's deduped output.
    expect(keys.length).toBe(thinkingTexts(v1).length);
  });

  test("reasoning dedup resets per turn: same text in two turns emits twice", async () => {
    const keys = thinkingTexts(await entries("reasoning-cross-turn.jsonl"));
    // turn-1 collapses its two identical reasonings to one; turn-2 re-emits the
    // same text after the turn_id reset → two entries, both the same text.
    expect(keys).toEqual(["weigh the same tradeoff", "weigh the same tradeoff"]);
  });

  test("token rollup: usage lands on the preceding agent_message", async () => {
    const all = await entries("token-usage.jsonl");
    const agent = all.find((e) => e.type === "agent_message");
    const usage = (agent?.payload as { usage?: Record<string, number> }).usage;
    expect(usage).toBeDefined();
    expect(usage?.input_tokens).toBe(40);
    expect(usage?.output_tokens).toBe(40);
    expect(usage?.cache_read_tokens).toBe(80);
    expect(usage?.reasoning_tokens).toBe(12);
    expect(usage?.total_tokens).toBe(160);
    expect(usage?.input_tokens_cumulative).toBe(400);
    expect(usage?.output_tokens_cumulative).toBe(400);
    expect(usage?.total_tokens_cumulative).toBe(1600);
    expect(usage?.context_input_tokens).toBe(120);
    expect(usage?.context_window_tokens).toBe(200000);
    // The carrier itself is dropped from output.
    expect(all.some((e) => (e.payload as { kind?: string }).kind === "x-codex/_usage")).toBe(false);
  });

  test("model replay: initial turn_context model stamps later agent_message", async () => {
    const all = await parseCodexSnapshotEntries(
      [
        baseSession,
        {
          timestamp: "2026-05-28T00:00:01.000Z",
          type: "turn_context",
          payload: { turn_id: "turn-1", model: "gpt-5-codex" },
        },
        {
          timestamp: "2026-05-28T00:00:02.000Z",
          type: "event_msg",
          payload: { type: "agent_message", message: "hello" },
        },
      ],
      "unit-test",
    );
    const agent = all.find((entry) => entry.type === "agent_message");
    expect(agent?.payload).toEqual({ text: "hello", model: "gpt-5-codex" });
  });

  test("model replay: initial turn_context model stamps later agent_thinking", async () => {
    const all = await parseCodexSnapshotEntries(
      [
        baseSession,
        {
          timestamp: "2026-05-28T00:00:01.000Z",
          type: "turn_context",
          payload: { turn_id: "turn-1", model: "gpt-5-codex" },
        },
        {
          timestamp: "2026-05-28T00:00:02.000Z",
          type: "event_msg",
          payload: { type: "agent_reasoning", text: "thinking" },
        },
      ],
      "unit-test",
    );
    const thinking = all.find((entry) => entry.type === "agent_thinking");
    expect(thinking?.payload).toEqual({ text: "thinking", model: "gpt-5-codex" });
  });

  test("model replay: model switch stamps subsequent agent_messages", async () => {
    const all = await parseCodexSnapshotEntries(
      [
        baseSession,
        {
          timestamp: "2026-05-28T00:00:01.000Z",
          type: "turn_context",
          payload: { turn_id: "turn-1", model: "gpt-5-codex" },
        },
        {
          timestamp: "2026-05-28T00:00:02.000Z",
          type: "event_msg",
          payload: { type: "agent_message", message: "first" },
        },
        {
          timestamp: "2026-05-28T00:00:03.000Z",
          type: "turn_context",
          payload: { turn_id: "turn-2", model: "gpt-5-codex-mini" },
        },
        {
          timestamp: "2026-05-28T00:00:04.000Z",
          type: "event_msg",
          payload: { type: "agent_message", message: "second" },
        },
      ],
      "unit-test",
    );
    const messages = all.filter((entry) => entry.type === "agent_message");
    expect(messages.map((entry) => entry.payload.model)).toEqual([
      "gpt-5-codex",
      "gpt-5-codex-mini",
    ]);
    const changes = all.filter((entry) => entry.type === "model_change");
    expect(changes.map((entry) => entry.payload)).toEqual([
      { to_model: "gpt-5-codex", trigger: "initial", turn_id: "turn-1" },
      {
        from_model: "gpt-5-codex",
        to_model: "gpt-5-codex-mini",
        trigger: "runtime_inferred",
        turn_id: "turn-2",
      },
    ]);
  });

  test("model replay: token_count model is fallback when no turn_context model exists", async () => {
    const all = await parseCodexSnapshotEntries(
      [
        baseSession,
        {
          timestamp: "2026-05-28T00:00:01.000Z",
          type: "event_msg",
          payload: { type: "agent_message", message: "from token row" },
        },
        {
          timestamp: "2026-05-28T00:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              model: "gpt-5-from-token-row",
              last_token_usage: { total_tokens: 11 },
            },
          },
        },
      ],
      "unit-test",
    );
    const agent = all.find((entry) => entry.type === "agent_message");
    expect(agent?.payload).toEqual({
      text: "from token row",
      model: "gpt-5-from-token-row",
      usage: { total_tokens: 11 },
    });
  });

  test("model_change synth: from/to across a turn_context model switch", async () => {
    const all = await entries("compact-and-model-change.jsonl");
    const change = all.find(
      (e) => e.type === "model_change" && typeof e.payload.from_model === "string",
    );
    expect(change).toBeDefined();
    expect(typeof (change?.payload as { to_model?: unknown }).to_model).toBe("string");
    expect(typeof (change?.payload as { from_model?: unknown }).from_model).toBe("string");
    expect(change?.source?.synthesized).toBe(true);
  });
});
