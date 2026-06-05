import { expect, test } from "bun:test";
import { DISCOVERY_CONCURRENCY_LIMIT, mapConcurrent } from "./concurrency.ts";

test("discovery concurrency limit is documented at 32", () => {
  expect(DISCOVERY_CONCURRENCY_LIMIT).toBe(32);
});

test("mapConcurrent preserves order and caps in-flight work", async () => {
  let active = 0;
  let maxActive = 0;
  const inputs = Array.from({ length: 20 }, (_value, index) => index);

  const results = await mapConcurrent(inputs, 4, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Bun.sleep(1);
    active -= 1;
    return value * 2;
  });

  expect(results).toEqual(inputs.map((value) => value * 2));
  expect(maxActive).toBeLessThanOrEqual(4);
});

test("mapConcurrent throws for invalid limit", async () => {
  const inputs = [1, 2, 3];
  for (const limit of [0, -1, 1.5]) {
    await expect(mapConcurrent(inputs, limit, async (value) => value)).rejects.toThrow(
      "concurrency limit must be a positive integer",
    );
  }
});

test("mapConcurrent stops pulling new work after mapper error", async () => {
  const inputs = Array.from({ length: 20 }, (_value, index) => index);
  const started: number[] = [];

  await expect(
    mapConcurrent(inputs, 4, async (value) => {
      started.push(value);
      if (value === 0) throw new Error("mapper failed");
      await Bun.sleep(5);
      return value;
    }),
  ).rejects.toThrow("mapper failed");

  expect(started.length).toBeLessThan(inputs.length);
});
