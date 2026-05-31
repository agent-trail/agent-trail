import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compareEntries, type DiffReport } from "../../diff-harness/index.ts";
import { claudeCodeAdapter } from "../index.ts";
import { parseClaudeCodeV2Entries } from "./index.ts";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/claude-code");

async function parity(fixture: string): Promise<{ report: DiffReport; oldCount: number }> {
  const path = join(FIXTURES, fixture);
  const oldTrail = await claudeCodeAdapter.parseSession({
    id: fixture,
    adapter: "claude-code",
    path,
  });
  const newEntries = await parseClaudeCodeV2Entries(path, "parity-test");
  return {
    report: compareEntries(oldTrail.entries, newEntries),
    oldCount: oldTrail.entries.length,
  };
}

const FIXTURE_FILES = [
  "basic-flow.jsonl",
  "interrupt-and-model-change.jsonl",
  "fidelity-edge-cases.jsonl",
  "permission-mode.jsonl",
];

describe("claude-code v2 parity", () => {
  for (const fixture of FIXTURE_FILES) {
    test(`${fixture}: every v1 entry preserved, no regressions`, async () => {
      const { report, oldCount } = await parity(fixture);
      expect(oldCount).toBeGreaterThan(0);
      expect(report.regressions).toEqual([]);
      expect(report.preserved).toHaveLength(oldCount);
      expect(report.blocking).toBe(false);
    });
  }
});
