import { isObject } from "./primitives/guards.ts";
import type { MatchPattern } from "./types.ts";

/**
 * Deep-partial match: every key in `pattern` must be present in `record` and
 * deep-equal. Nested plain objects recurse; all other values compare with
 * strict equality.
 *
 * Records come from parsed JSONL (acyclic by construction); circular references
 * are unsupported and would recurse infinitely. No depth guard — it would be
 * dead code for valid input.
 */
export function matchesPattern(record: Record<string, unknown>, pattern: MatchPattern): boolean {
  for (const key of Object.keys(pattern)) {
    const expected = pattern[key];
    const actual = record[key];
    if (isObject(expected)) {
      if (!isObject(actual)) return false;
      if (!matchesPattern(actual, expected)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}
