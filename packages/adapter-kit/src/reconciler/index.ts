import type { Entry } from "@agent-trail/types";
import type { ReconcilerConfig, ReconcilerRuleCtx } from "../types.ts";
import { cumulativeTokens } from "./cumulative-tokens.ts";
import { parentChain } from "./parent-chain.ts";
import { stripLinker } from "./strip-linker.ts";
import { toolLinking } from "./tool-linking.ts";

/**
 * Pass 2: walk the emitted entries and fill cross-references. Built-in rules
 * run in a fixed order when opted in, then any adapter `custom` passes, and
 * finally `meta.linker` hints are stripped (added in a later slice).
 */
export function reconcile(
  entries: Entry[],
  config: ReconcilerConfig,
  ctx: ReconcilerRuleCtx,
): Entry[] {
  if (config.branchReconciliation === true) {
    throw new Error(
      "branchReconciliation not yet implemented (Phase 4, #135). Disable it or use a linear session structure for now.",
    );
  }

  let result = entries;
  if (config.toolLinking === true) result = toolLinking(result);
  if (config.parentChain === true) result = parentChain(result);
  if (config.cumulativeTokens === true) result = cumulativeTokens(result);

  for (const rule of config.custom ?? []) {
    result = rule(result, ctx);
  }

  return stripLinker(result);
}
