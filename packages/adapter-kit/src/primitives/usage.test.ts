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
  });
});

test("mapAgentMessageUsage: accepts camelCase aliases", () => {
  expect(mapAgentMessageUsage({ inputTokens: 3, outputTokens: 4 })).toEqual({
    input_tokens: 3,
    output_tokens: 4,
  });
});

test("mapAgentMessageUsage: maps Pi's bare input/output/cacheRead/cacheWrite names", () => {
  // Real Pi `message.usage` uses these keys (verified against local sessions);
  // cacheWrite is Pi's cache-creation counter. totalTokens/cost have no spec
  // usage field and are intentionally dropped here.
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
    cache_read_tokens: 100,
    cache_creation_tokens: 50,
  });
});

test("mapAgentMessageUsage: renames cache_*_input_tokens to spec names", () => {
  expect(
    mapAgentMessageUsage({ cache_read_input_tokens: 8, cache_creation_input_tokens: 2 }),
  ).toEqual({ cache_read_tokens: 8, cache_creation_tokens: 2 });
});

test("mapAgentMessageUsage: maps cumulative + reasoning tokens", () => {
  expect(
    mapAgentMessageUsage({
      input_tokens_cumulative: 100,
      output_tokens_cumulative: 200,
      reasoning_tokens: 5,
    }),
  ).toEqual({
    input_tokens_cumulative: 100,
    output_tokens_cumulative: 200,
    reasoning_tokens: 5,
  });
});

test("mapAgentMessageUsage: returns undefined for no usable data", () => {
  expect(mapAgentMessageUsage(null)).toBeUndefined();
  expect(mapAgentMessageUsage("x")).toBeUndefined();
  expect(mapAgentMessageUsage({})).toBeUndefined();
  expect(mapAgentMessageUsage({ service_tier: "x" })).toBeUndefined();
});
