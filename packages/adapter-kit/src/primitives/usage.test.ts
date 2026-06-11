import { expect, test } from "bun:test";
import { mapAgentMessageUsage, pick } from "../index.ts";

test("pick: returns first non-negative integer across candidate keys", () => {
  expect(pick({ a: 5 }, ["a", "b"])).toBe(5);
  expect(pick({ a: 5, b: 9 }, ["b", "a"])).toBe(9);
  expect(pick({ a: -1, b: 7 }, ["a", "b"])).toBe(7);
  expect(pick({ a: 1.5, b: 7 }, ["a", "b"])).toBe(7);
  expect(pick({}, ["a"])).toBeUndefined();
});

test("mapAgentMessageUsage: maps snake_case input/output tokens", () => {
  expect(mapAgentMessageUsage({ input_tokens: 10, output_tokens: 20 })).toEqual({
    input_tokens: 10,
    output_tokens: 20,
    context_input_tokens: 10,
  });
});

test("mapAgentMessageUsage: accepts camelCase aliases", () => {
  expect(mapAgentMessageUsage({ inputTokens: 3, outputTokens: 4 })).toEqual({
    input_tokens: 3,
    output_tokens: 4,
    context_input_tokens: 3,
  });
});

test("mapAgentMessageUsage: maps Pi's bare input/output/cacheRead/cacheWrite names", () => {
  // Real Pi `message.usage` uses these keys (verified against local sessions);
  // cacheWrite is Pi's cache-creation counter. totalTokens is canonical; cost
  // remains source-only.
  expect(
    mapAgentMessageUsage({
      input: 1234,
      output: 567,
      cacheRead: 100,
      cacheWrite: 50,
      totalTokens: 1801,
      cost: 0.012,
    }),
  ).toEqual({
    input_tokens: 1234,
    output_tokens: 567,
    total_tokens: 1801,
    cache_read_tokens: 100,
    cache_creation_tokens: 50,
    context_input_tokens: 1384,
  });
});

test("mapAgentMessageUsage: accepts total-only usage", () => {
  expect(mapAgentMessageUsage({ totalTokens: 1801, cost: 0.012 })).toEqual({
    total_tokens: 1801,
  });
});

test("mapAgentMessageUsage: maps total aliases", () => {
  expect(mapAgentMessageUsage({ total_tokens: 10 })).toEqual({ total_tokens: 10 });
  expect(mapAgentMessageUsage({ total: 11 })).toEqual({ total_tokens: 11 });
  expect(mapAgentMessageUsage({ totalTokenCount: 12 })).toEqual({ total_tokens: 12 });
});

test("mapAgentMessageUsage: maps cumulative total aliases", () => {
  expect(mapAgentMessageUsage({ total_tokens_cumulative: 100 })).toEqual({
    total_tokens_cumulative: 100,
  });
  expect(mapAgentMessageUsage({ totalTokensCumulative: 101 })).toEqual({
    total_tokens_cumulative: 101,
  });
  expect(mapAgentMessageUsage({ cumulativeTotalTokens: 102 })).toEqual({
    total_tokens_cumulative: 102,
  });
});

test("mapAgentMessageUsage: derives Claude Code cache-inclusive context input tokens", () => {
  expect(
    mapAgentMessageUsage({
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 8,
      cache_creation_input_tokens: 2,
    }),
  ).toEqual({
    input_tokens: 10,
    output_tokens: 20,
    cache_read_tokens: 8,
    cache_creation_tokens: 2,
    context_input_tokens: 20,
  });
});

test("mapAgentMessageUsage: drops cache-only usage without input/output counters", () => {
  expect(
    mapAgentMessageUsage({ cache_read_input_tokens: 8, cache_creation_input_tokens: 2 }),
  ).toBeUndefined();
});

test("mapAgentMessageUsage: drops input-only usage without output counters", () => {
  expect(
    mapAgentMessageUsage({ input_tokens: 10, cache_read_tokens: 8, cache_creation_tokens: 2 }),
  ).toBeUndefined();
});

test("mapAgentMessageUsage: drops output-only usage without input counters", () => {
  expect(mapAgentMessageUsage({ output_tokens: 10, reasoning_tokens: 2 })).toBeUndefined();
});

test("mapAgentMessageUsage: preserves direct context usage fields", () => {
  expect(
    mapAgentMessageUsage({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 8,
      context_input_tokens: 42,
      contextWindowTokens: 200000,
    }),
  ).toEqual({
    input_tokens: 10,
    output_tokens: 5,
    cache_read_tokens: 8,
    context_input_tokens: 42,
    context_window_tokens: 200000,
  });
});

test("mapAgentMessageUsage: drops zero context window tokens", () => {
  expect(
    mapAgentMessageUsage({
      input_tokens: 10,
      output_tokens: 5,
      context_window_tokens: 0,
    }),
  ).toEqual({
    input_tokens: 10,
    output_tokens: 5,
    context_input_tokens: 10,
  });
});

test("mapAgentMessageUsage: maps cumulative + reasoning tokens", () => {
  expect(
    mapAgentMessageUsage({
      input_tokens_cumulative: 100,
      output_tokens_cumulative: 200,
      totalTokensCumulative: 300,
      reasoning_tokens: 5,
    }),
  ).toEqual({
    input_tokens_cumulative: 100,
    output_tokens_cumulative: 200,
    total_tokens_cumulative: 300,
    reasoning_tokens: 5,
  });
});

test("mapAgentMessageUsage: returns undefined for no usable data", () => {
  expect(mapAgentMessageUsage(null)).toBeUndefined();
  expect(mapAgentMessageUsage("x")).toBeUndefined();
  expect(mapAgentMessageUsage({})).toBeUndefined();
  expect(mapAgentMessageUsage({ service_tier: "x" })).toBeUndefined();
});
