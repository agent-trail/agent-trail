import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import type { V2HarnessTarget } from "../../diff-harness/index.ts";
import { piAdapter } from "../index.ts";
import { parsePiV2Entries } from "./index.ts";

/**
 * Entries whose payload is itself an id reference that legitimately rehashes
 * between adapters, so the harness can't compare them structurally:
 * - `branch_summary.abandoned_branch_id` — the issue's listed Pi `fromId`
 *   quirk-as-bug; v2 resolves it to its own entry-id scheme.
 * - `session_terminated.open_call_ids` — a synthesized list of tool_call entry ids.
 * v2 still emits these with correct non-id content (covered by unit tests).
 */
export function isPiIdReferenceEntry(entry: Entry): boolean {
  return entry.type === "branch_summary" || entry.type === "session_terminated";
}

export const piV2HarnessTarget: V2HarnessTarget = {
  agent: "pi",
  fixturesDir: join(import.meta.dir, "../../../tests/fixtures/pi"),
  old: piAdapter,
  parseNew: (path, sessionUid) => parsePiV2Entries(path, sessionUid),
  expectedDivergences: isPiIdReferenceEntry,
};
