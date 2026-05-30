import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { parseCodexV2Entries } from "./index.ts";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/codex");
const entries = (fixture: string): Promise<Entry[]> =>
  parseCodexV2Entries(join(FIXTURES, fixture), "unit-test");

const normalize = (t: string) => t.replace(/\s+/g, " ").trim();

describe("codex v2 stateful behaviors", () => {
  // The harness is a multiset, so un-deduped duplicates would pass as
  // non-blocking additions — assert the count + uniqueness directly.
  test("reasoning dedup: per-turn duplicates collapse", async () => {
    const all = await entries("reasoning-dedupe.jsonl");
    const thinking = all.filter((e) => e.type === "agent_thinking");
    const keys = thinking.map((e) => normalize(String((e.payload as { text: string }).text)));
    // No two emitted thinking entries share a normalized key (dedup held).
    expect(new Set(keys).size).toBe(keys.length);
    // The source carries more reasoning records than emitted entries.
    expect(thinking.length).toBeLessThan(4);
  });

  test("token rollup: usage lands on the preceding agent_message", async () => {
    const all = await entries("token-usage.jsonl");
    const agent = all.find((e) => e.type === "agent_message");
    const usage = (agent?.payload as { usage?: Record<string, number> }).usage;
    expect(usage).toBeDefined();
    expect(usage?.input_tokens).toBe(120);
    expect(usage?.output_tokens).toBe(40);
    expect(usage?.cache_read_tokens).toBe(80);
    expect(usage?.reasoning_tokens).toBe(12);
    expect(usage?.input_tokens_cumulative).toBe(1200);
    expect(usage?.output_tokens_cumulative).toBe(400);
    // The carrier itself is dropped from output.
    expect(all.some((e) => (e.payload as { kind?: string }).kind === "x-codex/_usage")).toBe(false);
  });

  test("model_change synth: from/to across a turn_context model switch", async () => {
    const all = await entries("compact-and-model-change.jsonl");
    const change = all.find((e) => e.type === "model_change");
    expect(change).toBeDefined();
    expect(typeof (change?.payload as { to_model?: unknown }).to_model).toBe("string");
    expect(typeof (change?.payload as { from_model?: unknown }).from_model).toBe("string");
    expect(change?.source?.synthesized).toBe(true);
  });
});
