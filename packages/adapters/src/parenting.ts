import type { Entry } from "@agent-trail/types";

export type ParentableEntry = {
  entry: Entry;
  parentSourceId: string | null | undefined;
  localParentId?: string;
};

function resolveParentId(
  startParentSourceId: string | null | undefined,
  parentBySourceId: Map<string, string | null>,
  sourceIdToLastEntryId: Map<string, string>,
): string | undefined {
  let cursor: string | null | undefined = startParentSourceId;
  const guard = new Set<string>();
  while (typeof cursor === "string") {
    if (guard.has(cursor)) return undefined;
    guard.add(cursor);
    const entryId = sourceIdToLastEntryId.get(cursor);
    if (entryId !== undefined) return entryId;
    cursor = parentBySourceId.get(cursor) ?? undefined;
  }
  return undefined;
}

export function resolveEntryParents(
  built: ParentableEntry[],
  parentBySourceId: Map<string, string | null>,
  sourceIdToLastEntryId: Map<string, string>,
): Entry[] {
  return built.map(({ entry, parentSourceId, localParentId }) => {
    const resolved =
      localParentId ?? resolveParentId(parentSourceId, parentBySourceId, sourceIdToLastEntryId);
    return resolved !== undefined ? { ...entry, parent_id: resolved } : entry;
  });
}
