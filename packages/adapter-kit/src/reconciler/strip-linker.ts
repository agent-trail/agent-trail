import type { Entry } from "@agent-trail/types";

/**
 * Remove transient `meta.linker` hints before final output — the trail `meta`
 * field has no `linker` slot. If `meta` has no other keys left, drop it too.
 */
export function stripLinker(entries: Entry[]): Entry[] {
  return entries.map((entry) => {
    if (entry.meta === undefined || !("linker" in entry.meta)) return entry;
    const { linker: _linker, ...rest } = entry.meta;
    if (Object.keys(rest).length === 0) {
      const { meta: _meta, ...entryRest } = entry;
      return entryRest as Entry;
    }
    return { ...entry, meta: rest } as Entry;
  });
}
