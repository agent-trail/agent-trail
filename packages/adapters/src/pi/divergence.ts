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

function nearestMappedAncestor(
  startSourceId: string,
  parentBySourceId: Map<string, string | null>,
  sourceIdToFirstEntryId: Map<string, string>,
): string | undefined {
  let cursor: string | null | undefined = startSourceId;
  const guard = new Set<string>();
  while (typeof cursor === "string") {
    if (guard.has(cursor)) return undefined;
    guard.add(cursor);
    const entry = sourceIdToFirstEntryId.get(cursor);
    if (entry !== undefined) return entry;
    cursor = parentBySourceId.get(cursor) ?? null;
  }
  return undefined;
}

// `sourceIdToFirstEntryId` maps a Pi envelope id to the **first** Agent Trail entry it emitted.
// For multi-block envelopes (assistant message with text + toolCall blocks), the first entry sits
// directly under the divergence parent and is therefore the spec §9.3 "root of abandoned branch".
// Using last-entry here would misanchor branch summaries deeper into the multi-block fan-out.
export function findAbandonedBranchRootId(
  fromSourceId: string,
  activeLeafSourceId: string | undefined,
  parentBySourceId: Map<string, string | null>,
  sourceIdToFirstEntryId: Map<string, string>,
): string {
  const fallback = () =>
    nearestMappedAncestor(fromSourceId, parentBySourceId, sourceIdToFirstEntryId) ?? fromSourceId;

  if (activeLeafSourceId === undefined) return fallback();

  const active = pathToRootInSourceIds(activeLeafSourceId, parentBySourceId);
  const abandoned = pathToRootInSourceIds(fromSourceId, parentBySourceId);

  if (abandoned.length === 0) return fallback();

  let i = 0;
  while (i < active.length && i < abandoned.length && active[i] === abandoned[i]) {
    i += 1;
  }
  if (i === 0) return fallback(); // no shared ancestor
  if (i >= abandoned.length) return fallback(); // fromId fully on active path

  // Walk deeper into the abandoned subtree until we find a source id that emitted an entry.
  for (let j = i; j < abandoned.length; j += 1) {
    const candidate = abandoned[j] as string;
    const entry = sourceIdToFirstEntryId.get(candidate);
    if (entry !== undefined) return entry;
  }
  // Abandoned subtree exists in topology but emits no entries (all envelopes were unmapped types).
  // Fall back to nearest mapped ancestor of fromId (climbs the shared portion of the chain).
  return fallback();
}
