import type { Entry } from "@agent-trail/types";

/**
 * Fill `parent_id` for entries that don't set it explicitly, chaining each to
 * the previous emitted entry. The first entry's parent is `null` (root). A
 * mapping that sets `parent_id` (including explicit `null`) is left untouched —
 * tree-topology adapters use that to override the linear default.
 */
export function parentChain(entries: Entry[]): Entry[] {
  let prev: string | null = null;
  return entries.map((entry) => {
    const parent_id = entry.parent_id !== undefined ? entry.parent_id : prev;
    prev = entry.id;
    return { ...entry, parent_id };
  });
}
