import { describe, expect, test } from "bun:test";
import type { AdapterDef } from "@agent-trail/adapter-kit";
import { mappingShapeMetric } from "./metric.ts";

function def(pure: number, override: number): AdapterDef {
  const mapping = { match: {}, emit: () => [] };
  const override_ = { match: {}, emit: () => [] };
  return {
    mappings: Array.from({ length: pure }, () => mapping),
    overrides: Array.from({ length: override }, () => override_),
  } as unknown as AdapterDef;
}

describe("mappingShapeMetric", () => {
  test("counts pure vs override and computes override ratio", () => {
    const metric = mappingShapeMetric(def(3, 1));

    expect(metric.pure).toBe(3);
    expect(metric.override).toBe(1);
    expect(metric.ratio).toBeCloseTo(0.25, 5);
  });

  test("no overrides → ratio 0", () => {
    const metric = mappingShapeMetric(def(4, 0));

    expect(metric.override).toBe(0);
    expect(metric.ratio).toBe(0);
  });

  test("no mappings or overrides → ratio 0 (no divide-by-zero)", () => {
    const metric = mappingShapeMetric(def(0, 0));

    expect(metric.ratio).toBe(0);
  });

  test("overrides field absent → treated as 0 (exercises optional chaining)", () => {
    const metric = mappingShapeMetric({
      mappings: [{ match: {}, emit: () => [] }],
    } as unknown as AdapterDef);

    expect(metric.override).toBe(0);
    expect(metric.ratio).toBe(0);
  });

  test("all overrides, no pure mappings → ratio 1", () => {
    const metric = mappingShapeMetric(def(0, 2));

    expect(metric.pure).toBe(0);
    expect(metric.override).toBe(2);
    expect(metric.ratio).toBe(1);
  });
});
