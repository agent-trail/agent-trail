import type { Entry } from "@agent-trail/types";
import type { BuiltEntry } from "./entry-metadata.ts";

function resolveParentId(
  startParentUuid: string | null | undefined,
  parentByUuid: Map<string, string | null>,
  sourceUuidToLastEntryId: Map<string, string>,
): string | undefined {
  let cursor: string | null | undefined = startParentUuid;
  const guard = new Set<string>();
  while (typeof cursor === "string") {
    if (guard.has(cursor)) return undefined;
    guard.add(cursor);
    const entryId = sourceUuidToLastEntryId.get(cursor);
    if (entryId !== undefined) return entryId;
    cursor = parentByUuid.get(cursor) ?? undefined;
  }
  return undefined;
}

export function resolveEntryParents(
  built: BuiltEntry[],
  parentByUuid: Map<string, string | null>,
  sourceUuidToLastEntryId: Map<string, string>,
): Entry[] {
  return built.map(({ entry, parentUuid, localParentId }) => {
    const resolved =
      localParentId ?? resolveParentId(parentUuid, parentByUuid, sourceUuidToLastEntryId);
    return resolved !== undefined ? { ...entry, parent_id: resolved } : entry;
  });
}
