import { join } from "node:path";
import type { V2HarnessTarget } from "../../diff-harness/index.ts";
import { piAdapter } from "../index.ts";
import { parsePiV2Entries } from "./index.ts";

// No expectedDivergences: branch_summary.abandoned_branch_id and
// session_terminated.open_call_ids are id references the harness strips during
// canonicalization (compare.ts), so those entries compare structurally on
// everything else — no whole-entry suppression needed.
export const piV2HarnessTarget: V2HarnessTarget = {
  agent: "pi",
  fixturesDir: join(import.meta.dir, "../../../tests/fixtures/pi"),
  old: piAdapter,
  parseNew: (path, sessionUid) => parsePiV2Entries(path, sessionUid),
};
