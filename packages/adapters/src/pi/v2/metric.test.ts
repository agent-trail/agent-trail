import { describe, expect, test } from "bun:test";
import type { AdapterDef } from "@agent-trail/adapter-kit";
import { mappingShapeMetric } from "../../diff-harness/index.ts";
import { makePiMappings } from "./mappings.ts";

describe("pi v2 declarative-coverage metric", () => {
  test("fully declarative: zero overrides (override-ratio 0)", () => {
    const def = { mappings: makePiMappings("3"), overrides: undefined } as unknown as AdapterDef;
    const metric = mappingShapeMetric(def);

    expect(metric.override).toBe(0);
    expect(metric.ratio).toBe(0);
    expect(metric.pure).toBeGreaterThan(0);
  });
});
