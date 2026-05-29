import { matchesPattern } from "./match.ts";
import type { RawRecord } from "./readers/types.ts";
import type { MappingDef } from "./types.ts";

/**
 * Select the first mapping whose `match` pattern matches the record. First
 * match wins, so order mappings most-specific first when patterns overlap.
 *
 * The matched mapping's input type is runtime-dependent (which pattern hit),
 * so it cannot be statically narrowed — the return is `MappingDef<any>` and
 * callers re-assert the concrete record type inside `emit`.
 */
export function dispatch(
  record: RawRecord,
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous mapping inputs
  mappings: MappingDef<any>[],
  // biome-ignore lint/suspicious/noExplicitAny: returned mapping is caller-typed
): MappingDef<any> | undefined {
  return mappings.find((mapping) => matchesPattern(record, mapping.match));
}
