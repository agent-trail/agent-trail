function pathToRootInSourceIds(
  startSourceId: string,
  parentBySourceId: Map<string, string | null>,
): string[] {
  const path: string[] = [];
  const guard = new Set<string>();
  let cursor: string | null | undefined = startSourceId;
  while (typeof cursor === "string") {
    if (guard.has(cursor)) break;
    guard.add(cursor);
    if (!parentBySourceId.has(cursor)) break;
    path.push(cursor);
    cursor = parentBySourceId.get(cursor) ?? null;
  }
  return path.reverse();
}

export function findAbandonedBranchRootId(
  fromSourceId: string,
  activeLeafSourceId: string | undefined,
  parentBySourceId: Map<string, string | null>,
  sourceIdToLastEntryId: Map<string, string>,
): string {
  const resolveOrSelf = (sourceId: string) => sourceIdToLastEntryId.get(sourceId) ?? sourceId;
  if (activeLeafSourceId === undefined) return resolveOrSelf(fromSourceId);

  const active = pathToRootInSourceIds(activeLeafSourceId, parentBySourceId);
  const abandoned = pathToRootInSourceIds(fromSourceId, parentBySourceId);

  if (abandoned.length === 0) return resolveOrSelf(fromSourceId);

  let i = 0;
  while (i < active.length && i < abandoned.length && active[i] === abandoned[i]) {
    i += 1;
  }
  // fromId entirely on active path (degenerate — pi-mono normally never appends a branch_summary
  // pointing into the active branch; fall back to fromId's own entry id).
  if (i >= abandoned.length) return resolveOrSelf(fromSourceId);
  // No shared ancestor (fromId in a disjoint subgraph; fall back to fromId).
  if (i === 0) return resolveOrSelf(fromSourceId);
  return resolveOrSelf(abandoned[i] as string);
}
