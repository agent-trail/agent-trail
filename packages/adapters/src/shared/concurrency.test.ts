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
