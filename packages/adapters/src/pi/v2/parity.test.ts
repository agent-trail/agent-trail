import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compareEntries, type DiffReport } from "../../diff-harness/index.ts";
import { piAdapter } from "../index.ts";
import { parsePiV2Entries } from "./index.ts";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/pi");

async function parity(fixture: string): Promise<{ report: DiffReport; oldCount: number }> {
  const path = join(FIXTURES, fixture);
  const oldTrail = await piAdapter.parseSession({ id: fixture, adapter: "pi", path });
  const newEntries = await parsePiV2Entries(path, "parity-test");
  return {
    report: compareEntries(oldTrail.entries, newEntries),
    oldCount: oldTrail.entries.length,
  };
}

const FIXTURE_FILES = [
  "linear-flow.jsonl",
  "usage-and-cost.jsonl",
  "reasoning-and-interrupt.jsonl",
  "compaction-and-model-change.jsonl",
  "branch-flow.jsonl",
  "system-events.jsonl",
  "tool-result-error.jsonl",
  "quarantine.jsonl",
];

describe("pi v2 parity", () => {
  for (const fixture of FIXTURE_FILES) {
    test(`${fixture}: every v1 entry preserved, no regressions`, async () => {
      const { report, oldCount } = await parity(fixture);
      expect(oldCount).toBeGreaterThan(0);
      expect(report.regressions).toEqual([]);
      expect(report.blocking).toBe(false);
      // Every v1 entry is preserved structurally (id-reference payload fields are
      // stripped during canonicalization, so branch_summary / session_terminated
      // compare on their non-id content).
      expect(report.preserved).toHaveLength(oldCount);
    });
  }
});
