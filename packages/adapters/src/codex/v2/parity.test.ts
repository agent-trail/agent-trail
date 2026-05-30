import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { compareEntries, type DiffReport } from "../../diff-harness/index.ts";
import { codexAdapter } from "../index.ts";
import { parseCodexV2Entries } from "./index.ts";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/codex");

async function parity(fixture: string): Promise<{ report: DiffReport; oldCount: number }> {
  const path = join(FIXTURES, fixture);
  const oldTrail = await codexAdapter.parseSession({ id: fixture, adapter: "codex", path });
  const newEntries = await parseCodexV2Entries(path, "parity-test");
  return {
    report: compareEntries(oldTrail.entries, newEntries),
    oldCount: oldTrail.entries.length,
  };
}

const FIXTURE_FILES = [
  "desktop-tracer.jsonl",
  "apply-patch.jsonl",
  "compact-and-model-change.jsonl",
  "reasoning-dedupe.jsonl",
  "web-search.jsonl",
  "lifecycle.jsonl",
  "token-usage.jsonl",
  "reasoning-cross-turn.jsonl",
];

describe("codex v2 parity", () => {
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
