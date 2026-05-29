import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Entry } from "@agent-trail/types";
import type { SessionRef, TrailAdapter } from "../index.ts";
import { type CompareOptions, compareEntries, type DiffReport } from "./compare.ts";

export type { CompareOptions, DiffReport } from "./compare.ts";
export { canonicalizeEntry, compareEntries } from "./compare.ts";
export type { MappingShapeMetric } from "./metric.ts";
export { mappingShapeMetric } from "./metric.ts";

/**
 * One adapter under migration: the old (live) adapter, a function running the new
 * kit-based adapter over the same source file, the synthetic fixture corpus to
 * run both over, and the quirks the new adapter is allowed to diverge on.
 */
export interface V2HarnessTarget {
  agent: string;
  /** Directory of synthetic `.jsonl` fixtures (committed corpus). */
  fixturesDir: string;
  old: TrailAdapter;
  /** Run the new kit adapter over a source file, returning its emitted entries. */
  parseNew: (path: string, sessionUid: string) => Promise<Entry[]>;
  expectedDivergences?: CompareOptions["expectedDivergences"];
}

/**
 * Registry of adapters being migrated. Empty until the first migration PR — each
 * migration registers its target here so CI compares old vs new on every fixture.
 */
export const v2HarnessTargets: V2HarnessTarget[] = [];

export interface FixtureReport {
  agent: string;
  fixture: string;
  report: DiffReport;
}

export interface HarnessSummary {
  targets: number;
  reports: FixtureReport[];
  blocking: boolean;
}

export async function runDiffHarness(
  targets: V2HarnessTarget[] = v2HarnessTargets,
): Promise<HarnessSummary> {
  const reports: FixtureReport[] = [];

  for (const target of targets) {
    for (const path of fixturePaths(target.fixturesDir)) {
      const fixture = basename(path);
      const ref: SessionRef = { id: fixture, adapter: target.agent, path };
      const oldTrail = await target.old.parseSession(ref);
      const newEntries = await target.parseNew(path, fixture);
      const report = compareEntries(oldTrail.entries, newEntries, {
        expectedDivergences: target.expectedDivergences,
      });
      reports.push({ agent: target.agent, fixture, report });
    }
  }

  return {
    targets: targets.length,
    reports,
    blocking: reports.some((r) => r.report.blocking),
  };
}

function fixturePaths(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(dir, name));
}
