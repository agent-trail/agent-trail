import type { Entry } from "@agent-trail/types";

function linkerCallId(entry: Entry): string | undefined {
  const linker = (entry.meta as { linker?: unknown } | undefined)?.linker;
  if (linker === undefined) return undefined;
  if (typeof linker !== "object" || linker === null) {
    throw new Error(`toolLinking: meta.linker must be an object (got ${typeof linker})`);
  }
  const callId = (linker as { call_id?: unknown }).call_id;
  if (callId === undefined) return undefined;
  if (typeof callId !== "string") {
    throw new Error(`toolLinking: meta.linker.call_id must be a string (got ${typeof callId})`);
  }
  return callId;
}

/**
 * Link `tool_result` entries to their `tool_call` via `meta.linker.call_id`.
 * The result gains `payload.for_id` (the call entry's id) and `semantic.call_id`;
 * the call gains `semantic.call_id` so the pair shares a grouping key. Unmatched
 * results keep their `semantic.call_id` but get no `for_id`.
 */
export function toolLinking(entries: Entry[]): Entry[] {
  const callEntryIdByCallId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "tool_call") continue;
    const callId = linkerCallId(entry);
    if (callId !== undefined) callEntryIdByCallId.set(callId, entry.id);
  }

  return entries.map((entry) => {
    const callId = linkerCallId(entry);
    if (callId === undefined) return entry;

    if (entry.type === "tool_call") {
      return { ...entry, semantic: { ...entry.semantic, call_id: callId } } as Entry;
    }
    if (entry.type === "tool_result") {
      const forId = callEntryIdByCallId.get(callId);
      return {
        ...entry,
        payload: { ...entry.payload, ...(forId !== undefined ? { for_id: forId } : {}) },
        semantic: { ...entry.semantic, call_id: callId },
      } as Entry;
    }
    return entry;
  });
}
