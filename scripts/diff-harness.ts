#!/usr/bin/env bun
// Adapter migration diff harness (issue #146). Runs every registered old adapter
// and its new kit-based counterpart over the synthetic fixture corpus and reports
// the permissive regression bar: old entries MUST appear in the new output
// (canonicalized, id-rehash tolerant); new entries are coverage gains (non-blocking);
// listed quirks-as-bugs are expected divergences. Exits 1 on any blocking regression.
// The registry is empty until the first migration PR — then this becomes meaningful.
// Run: `bun run diff:adapters`.

import { runDiffHarness } from "../packages/adapters/src/diff-harness/index.ts";

async function main(): Promise<void> {
  const summary = await runDiffHarness();

  if (summary.targets === 0) {
    console.log("Adapter diff harness: no v2 adapters registered yet — nothing to compare.");
    return;
  }

  for (const { agent, fixture, report } of summary.reports) {
    const status = report.blocking ? "REGRESSION" : "ok";
    console.log(
      `[${agent}] ${fixture}: ${status} ` +
        `preserved=${report.preserved.length} ` +
        `regressions=${report.regressions.length} ` +
        `additions=${report.additions.length} ` +
        `divergences=${report.expectedDivergences.length}`,
    );
    for (const entry of report.regressions) {
      console.log(`    regression: ${entry.type} ${JSON.stringify(entry.payload)}`);
    }
  }

  console.log("---");
  const blockingCount = summary.reports.filter((r) => r.report.blocking).length;
  console.log(
    `Summary: ${summary.targets} adapter(s), ${summary.reports.length} fixture(s), ` +
      `blocking=${blockingCount}`,
  );

  if (summary.blocking) {
    process.exit(1);
  }
}

await main();
