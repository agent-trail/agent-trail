import { describe, expect, test } from "bun:test";
import { runDiffHarness, v2HarnessTargets } from "./index.ts";

describe("runDiffHarness", () => {
  test("empty registry → no reports, not blocking", async () => {
    const summary = await runDiffHarness([]);

    expect(summary.targets).toBe(0);
    expect(summary.reports).toHaveLength(0);
    expect(summary.blocking).toBe(false);
  });

  test("ships with an empty v2 registry until the first migration lands", () => {
    expect(v2HarnessTargets).toHaveLength(0);
  });
});
