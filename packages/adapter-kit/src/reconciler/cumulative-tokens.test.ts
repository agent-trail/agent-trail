import { describe, expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
import { reconcile } from "./index.ts";

const ctx = { agent: "pi" as const };

function agentMsg(id: string, usage: Record<string, number>): Entry {
  return {
    type: "agent_message",
    id,
    ts: "2026-05-29T00:00:00.000Z",
    payload: { text: "x", usage },
  } as Entry;
}

function usageOf(entry: Entry | undefined): Record<string, number> {
  return (entry?.payload as { usage: Record<string, number> }).usage;
}

describe("cumulativeTokens reconciler rule", () => {
  test("accumulates input/output token running totals across agent messages", () => {
    const out = reconcile(
      [
        agentMsg("a", { input_tokens: 10, output_tokens: 5 }),
        agentMsg("b", { input_tokens: 20, output_tokens: 8 }),
      ],
      { cumulativeTokens: true },
      ctx,
    );

    expect(usageOf(out[0])).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      input_tokens_cumulative: 10,
      output_tokens_cumulative: 5,
    });
    expect(usageOf(out[1])).toEqual({
      input_tokens: 20,
      output_tokens: 8,
      input_tokens_cumulative: 30,
      output_tokens_cumulative: 13,
    });
  });

  test("leaves usage untouched when cumulative fields already present", () => {
    const out = reconcile(
      [agentMsg("a", { input_tokens: 10, input_tokens_cumulative: 999 })],
      { cumulativeTokens: true },
      ctx,
    );

    expect(usageOf(out[0])).toEqual({ input_tokens: 10, input_tokens_cumulative: 999 });
  });

  test("advances running totals through entries that already carry cumulative counts", () => {
    const out = reconcile(
      [
        agentMsg("a", {
          input_tokens: 100,
          output_tokens: 50,
          input_tokens_cumulative: 100,
          output_tokens_cumulative: 50,
        }),
        agentMsg("b", { input_tokens: 10, output_tokens: 5 }),
      ],
      { cumulativeTokens: true },
      ctx,
    );

    // first entry untouched; second continues from the prior cumulative.
    expect(usageOf(out[0])).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      input_tokens_cumulative: 100,
      output_tokens_cumulative: 50,
    });
    expect(usageOf(out[1])).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      input_tokens_cumulative: 110,
      output_tokens_cumulative: 55,
    });
  });

  test("no-op when cumulativeTokens disabled", () => {
    const out = reconcile([agentMsg("a", { input_tokens: 10 })], {}, ctx);
    expect(usageOf(out[0])).toEqual({ input_tokens: 10 });
  });
});
