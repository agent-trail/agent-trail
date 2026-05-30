import { existsSync, readdirSync, statSync } from "node:fs";
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
 *
 * Registering a target (in a migration PR) looks like:
 *
 * ```ts
 * v2HarnessTargets.push({
 *   agent: "pi",
 *   fixturesDir: join(import.meta.dir, "../../tests/fixtures/pi"),
 *   old: piAdapter,
 *   parseNew: (path, sessionUid) => piAdapterV2.parse({ path }, { sessionUid }),
 *   // quirks-as-bugs the new adapter deliberately does NOT preserve (issue #146):
 *   expectedDivergences: (entry) => isPiFromIdOverwrite(entry),
 * });
 * ```
 */
export interface V2HarnessTarget {
  agent: string;
  /** Directory of synthetic `.jsonl` fixtures (committed corpus). */
  fixturesDir: string;
  old: TrailAdapter;
  /** Run the new kit adapter over a source file, returning its emitted entries. */
  parseNew: (path: string, sessionUid: string) => Promise<Entry[]>;
  expectedDivergences?: CompareOptions["expectedDivergences"];
  /**
   * Per-fixture session id seeded into the new adapter (spec §8.5). Defaults to
   * the fixture basename. Override when the migration needs a specific value or
   * cross-directory uniqueness; ids are stripped during comparison, so this only
   * matters if the adapter's non-id output depends on it.
   */
  sessionUidFor?: (path: string) => string;
  /**
   * Extra `SessionRef` fields (e.g. `cwd`, `modifiedAt`) the old adapter needs to
   * locate or contextualize a session. Merged over the harness defaults.
   */
  sessionRef?: Partial<Omit<SessionRef, "id" | "adapter" | "path">>;
}

/**
 * Registry of adapters being migrated. Empty until the first migration PR — each
 * migration registers its target here so CI compares old vs new on every fixture.
 */
export const v2HarnessTargets: V2HarnessTarget[] = [];

export interface FixtureReport {
  agent: string;
  fixture: string;
  /** Comparison result; absent when the run threw before producing one. */
  report?: DiffReport;
  /** Set when the old/new parse (or fixture discovery) threw. Always blocking. */
  error?: string;
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
    let paths: string[];
    try {
      paths = fixturePaths(target.fixturesDir);
    } catch (error) {
      reports.push({ agent: target.agent, fixture: target.fixturesDir, error: message(error) });
      continue;
    }

    for (const path of paths) {
      const fixture = basename(path);
      try {
        const ref: SessionRef = {
          id: fixture,
          adapter: target.agent,
          path,
          ...target.sessionRef,
        };
        const sessionUid = target.sessionUidFor?.(path) ?? fixture;
        const oldTrail = await target.old.parseSession(ref);
        const newEntries = await target.parseNew(path, sessionUid);
        const report = compareEntries(oldTrail.entries, newEntries, {
          expectedDivergences: target.expectedDivergences,
        });
        reports.push({ agent: target.agent, fixture, report });
      } catch (error) {
        reports.push({ agent: target.agent, fixture, error: message(error) });
      }
    }
  }

  return {
    targets: targets.length,
    reports,
    blocking: reports.some((r) => r.error !== undefined || r.report?.blocking === true),
  };
}

function fixturePaths(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`fixturesDir is not a directory: ${dir}`);
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(dir, name));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
