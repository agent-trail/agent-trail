// Pi-specific pass-2 reconciler rules. Pi is tree-native and synthesizes entries
// that the kit's per-record mappings can't express, and the kit's general
// `branchReconciliation` is deferred (#135) — so these custom rules stand in for
// it. Order matters and is fixed in adapter.ts: piModelChangeFromModel runs first
// (it reads the assistant model off the parenting hint, which piParentResolution
// later strips), then piToolKindToResult, piParentResolution, piSessionTerminatedEof.
import type { RawRecord, ReconcilerRule } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import { type ParentableEntry, resolveEntryParents } from "../parenting.ts";
import { deriveSynthesizedEntryId, PI_ENTRY_ID_NAMESPACE } from "../session-uid.ts";
import { findAbandonedBranchRootId, nearestMappedAncestor } from "./divergence.ts";
import { PARENT_HINT, type ParentHint } from "./mappings.ts";

function hintOf(entry: Entry): ParentHint | undefined {
  const meta = entry.meta as Record<string, unknown> | undefined;
  const hint = meta?.[PARENT_HINT];
  return hint as ParentHint | undefined;
}

function stripHint(entry: Entry): Entry {
  const meta = entry.meta as Record<string, unknown> | undefined;
  if (meta === undefined || !(PARENT_HINT in meta)) return entry;
  const { [PARENT_HINT]: _drop, ...rest } = meta;
  return { ...entry, meta: rest };
}

function rawParentEdge(raw: Record<string, unknown> | undefined): ParentHintEdge | undefined {
  if (raw === undefined) return undefined;
  if (raw.type === "session") return undefined;
  const sid = raw.id;
  if (typeof sid !== "string") return undefined;
  const rawPid = raw.parentId;
  return { sid, pid: typeof rawPid === "string" ? rawPid : null };
}

type ParentHintEdge = { sid: string; pid: string | null };

function firstKeptEntryIdFrom(entry: Entry): string | undefined {
  const raw = entry.source?.raw;
  if (raw !== undefined) {
    const firstKept = (raw as Record<string, unknown>).firstKeptEntryId;
    if (typeof firstKept === "string") return firstKept;
  }
  const piMeta = entry.meta?.["dev.pi.compaction"];
  if (piMeta !== null && typeof piMeta === "object") {
    const firstKept = (piMeta as Record<string, unknown>).firstKeptEntryId;
    if (typeof firstKept === "string") return firstKept;
  }
  return undefined;
}

// Resolve a leaf/label target (a raw Pi source id) to the trail entry id it
// points at: the entry the source id emitted, or — if that source id emitted
// nothing (e.g. an unmapped/dropped intermediate) — the nearest mapped ancestor,
// mirroring how abandoned_branch_id resolves. Returns undefined only when the
// whole ancestor chain is unmapped; the caller then keeps the raw id as a
// last-resort audit pointer rather than inventing a reference.
function resolveTargetEntryId(
  rawTargetId: string,
  parentBySourceId: Map<string, string | null>,
  sourceIdToFirstEntryId: Map<string, string>,
): string | undefined {
  return nearestMappedAncestor(rawTargetId, parentBySourceId, sourceIdToFirstEntryId);
}

function sourceIdFromRecord(record: RawRecord): string | undefined {
  const id = (record as Record<string, unknown>).id;
  return typeof id === "string" ? id : undefined;
}

function replacedIdsBeforeSourceId(
  firstKeptSourceId: string,
  records: RawRecord[],
  sourceIdToEntryIds: Map<string, string[]>,
): string[] | undefined {
  const replaced: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const sourceId = sourceIdFromRecord(record);
    if (sourceId === undefined) continue;
    if (sourceId === firstKeptSourceId) {
      return replaced.length > 0 ? replaced : undefined;
    }
    const entryIds = sourceIdToEntryIds.get(sourceId);
    if (entryIds === undefined) continue;
    for (const entryId of entryIds) {
      if (seen.has(entryId)) continue;
      seen.add(entryId);
      replaced.push(entryId);
    }
  }
  return undefined;
}

function rawParentEdgeFromEntry(entry: Entry): ParentHintEdge | undefined {
  return rawParentEdge(
    entry.source?.raw ??
      ((entry.payload as { data?: { raw?: unknown } }).data?.raw as
        | Record<string, unknown>
        | undefined),
  );
}

function rawParentEdgeFromRecord(record: RawRecord): ParentHintEdge | undefined {
  return rawParentEdge(record as Record<string, unknown>);
}

/**
 * Pi tree-topology pass (replaces the deferred kit `branchReconciliation`).
 * Rebuilds the source-id → entry-id maps from the `PARENT_HINT` stashed by the
 * mappings, fills `parent_id` (intra-envelope block chains honored), resolves
 * each `branch_summary.abandoned_branch_id` via the divergence walk, then strips
 * the transient hints. Tree parenting + `divergence.ts` for Pi's forked sessions.
 */
export const piParentResolution: ReconcilerRule = (entries, ctx) => {
  const parentBySourceId = new Map<string, string | null>();
  const sourceIdToFirstEntryId = new Map<string, string>();
  const sourceIdToEntryIds = new Map<string, string[]>();
  const sourceIdToLastEntryId = new Map<string, string>();
  const lastEntryIdForSid = new Map<string, string>();

  for (const record of ctx.records ?? []) {
    const edge = rawParentEdgeFromRecord(record);
    if (edge !== undefined && !parentBySourceId.has(edge.sid)) {
      parentBySourceId.set(edge.sid, edge.pid);
    }
  }

  for (const entry of entries) {
    const edge = rawParentEdgeFromEntry(entry);
    if (edge !== undefined && !parentBySourceId.has(edge.sid)) {
      parentBySourceId.set(edge.sid, edge.pid);
    }
    const hint = hintOf(entry);
    const provenanceSourceId = hint?.sid ?? edge?.sid;
    if (provenanceSourceId !== undefined) {
      const sourceEntryIds = sourceIdToEntryIds.get(provenanceSourceId) ?? [];
      sourceEntryIds.push(entry.id);
      sourceIdToEntryIds.set(provenanceSourceId, sourceEntryIds);
    }
    if (hint === undefined) continue;
    if (hint !== undefined && !parentBySourceId.has(hint.sid)) {
      parentBySourceId.set(hint.sid, hint.pid);
    }
    if (!sourceIdToFirstEntryId.has(hint.sid)) sourceIdToFirstEntryId.set(hint.sid, entry.id);
    sourceIdToLastEntryId.set(hint.sid, entry.id);
  }

  const built: ParentableEntry[] = entries.map((entry) => {
    const hint = hintOf(entry);
    if (hint === undefined) {
      return { entry, parentSourceId: rawParentEdgeFromEntry(entry)?.pid ?? null };
    }
    // Within one source envelope (multi-block assistant), each block after the
    // first chains off the previous block's entry. Safe regardless of other
    // entries interleaving: the kit emits one record's drafts contiguously and
    // this map is keyed by source id, so only same-envelope blocks chain here.
    const localParentId = lastEntryIdForSid.get(hint.sid);
    lastEntryIdForSid.set(hint.sid, entry.id);
    return { entry, parentSourceId: hint.pid, localParentId };
  });

  const parented = resolveEntryParents(built, parentBySourceId, sourceIdToLastEntryId);

  // Pi's authoritative active-branch-tip, tracked positionally: the most recent
  // `x-pi/leaf_change` at or before a branch_summary is the active leaf when that
  // summary was recorded. Falls back to the branch_summary's own parent when no
  // explicit leaf precedes it (the pre-#125 behavior — so leaf-free sessions are
  // unchanged). Raw Pi source id, since findAbandonedBranchRootId walks by it.
  let activeLeafSourceId: string | undefined;

  return parented.map((entry) => {
    const hint = hintOf(entry);
    let next = entry;
    if (entry.type === "system_event") {
      const payload = entry.payload as { kind?: string; data?: Record<string, unknown> };
      if (payload.kind === "x-pi/leaf_change") {
        const rawLeaf = payload.data?.leaf_id;
        if (typeof rawLeaf === "string") {
          activeLeafSourceId = rawLeaf; // raw id captured before resolution below
          const mapped = resolveTargetEntryId(rawLeaf, parentBySourceId, sourceIdToFirstEntryId);
          if (mapped !== undefined) {
            next = {
              ...next,
              payload: { ...payload, data: { ...payload.data, leaf_id: mapped } },
            } as Entry;
          }
        } else {
          // A cleared tip (Pi leaf targetId:null → no data.leaf_id) resets the
          // tracker, so a later branch_summary falls back to its own parent
          // rather than a stale leaf.
          activeLeafSourceId = undefined;
        }
      } else if (payload.kind === "x-pi/label") {
        const rawTarget = payload.data?.target_id;
        if (typeof rawTarget === "string") {
          const mapped = resolveTargetEntryId(rawTarget, parentBySourceId, sourceIdToFirstEntryId);
          if (mapped !== undefined) {
            next = {
              ...next,
              payload: { ...payload, data: { ...payload.data, target_id: mapped } },
            } as Entry;
          }
        }
      }
    }
    if (hint?.fromId !== undefined && entry.type === "branch_summary") {
      const activeLeaf =
        activeLeafSourceId ?? (typeof hint.pid === "string" ? hint.pid : undefined);
      const resolved = findAbandonedBranchRootId(
        hint.fromId,
        activeLeaf,
        parentBySourceId,
        sourceIdToFirstEntryId,
      );
      next = {
        ...entry,
        payload: { ...entry.payload, abandoned_branch_id: resolved },
      } as Entry;
    }
    if (entry.type === "context_compact") {
      const firstKeptEntryId = firstKeptEntryIdFrom(entry);
      const replaced =
        firstKeptEntryId !== undefined
          ? replacedIdsBeforeSourceId(firstKeptEntryId, ctx.records ?? [], sourceIdToEntryIds)
          : undefined;
      if (replaced !== undefined) {
        next = {
          ...next,
          payload: { ...next.payload, replaced_message_ids: replaced },
        } as Entry;
      }
    }
    next = backfillEnvelopeRef(next, hint, sourceIdToFirstEntryId);
    return stripHint(next);
  });
};

// Multi-block assistant blocks after the first carry `source.raw.envelope_ref`
// pointing at the first block's entry id (placeholder until now). Replace it with
// the real first-entry id of the same source envelope.
function backfillEnvelopeRef(
  entry: Entry,
  hint: ParentHint | undefined,
  sourceIdToFirstEntryId: Map<string, string>,
): Entry {
  if (hint === undefined) return entry;
  const source = entry.source as { raw?: Record<string, unknown> } | undefined;
  const raw = source?.raw;
  if (raw === undefined || !("envelope_ref" in raw)) return entry;
  const firstEntryId = sourceIdToFirstEntryId.get(hint.sid);
  if (firstEntryId === undefined) return entry;
  return {
    ...entry,
    source: { ...source, raw: { ...raw, envelope_ref: firstEntryId } },
  } as Entry;
}

/**
 * Copy `semantic.tool_kind` from each `tool_call` onto its linked `tool_result`
 * (linked by `payload.for_id`, set by the built-in `toolLinking` pass). v1
 * carries the call's canonical tool kind on the result; the kit does not.
 */
export const piToolKindToResult: ReconcilerRule = (entries) => {
  const toolKindByCallEntryId = new Map<string, ToolKind>();
  const readRangeByCallEntryId = new Map<string, [number, number]>();
  for (const entry of entries) {
    if (entry.type !== "tool_call") continue;
    const kind = entry.semantic?.tool_kind;
    if (kind !== undefined) toolKindByCallEntryId.set(entry.id, kind);
    if (kind === "file_read") {
      const range = (entry.payload as { args?: { range?: unknown } }).args?.range;
      if (
        Array.isArray(range) &&
        range.length === 2 &&
        typeof range[0] === "number" &&
        typeof range[1] === "number"
      ) {
        readRangeByCallEntryId.set(entry.id, [range[0], range[1]]);
      }
    }
  }

  return entries.map((entry) => {
    if (entry.type !== "tool_result") return entry;
    const forId = (entry.payload as { for_id?: unknown }).for_id;
    if (typeof forId !== "string") return entry;
    const kind = toolKindByCallEntryId.get(forId);
    if (kind === undefined) return entry;
    const range = readRangeByCallEntryId.get(forId);
    return {
      ...entry,
      payload:
        range === undefined
          ? entry.payload
          : {
              ...entry.payload,
              meta: {
                ...(entry.payload as { meta?: object }).meta,
                file_read: {
                  ...((entry.payload as { meta?: { file_read?: object } }).meta?.file_read ?? {}),
                  range,
                },
              },
            },
      semantic: { ...entry.semantic, tool_kind: kind },
    };
  });
};

/**
 * Fill `model_change.payload.from_model` from the model in effect before the
 * change. v1 threads `prevModel` across source envelopes, advancing it on each
 * emitted assistant message (its model) and each model_change (its to_model).
 *
 * Reads the source assistant model off the parenting hint (`hint.model`), which
 * every entry an assistant envelope emits carries — so a tool_call-only or
 * thinking-only assistant (whose entries hold no model in their own payload)
 * still advances `prevModel`, matching v1. MUST run before `piParentResolution`,
 * which strips the hint.
 */
export const piModelChangeFromModel: ReconcilerRule = (entries) => {
  let prevModel: string | undefined;
  return entries.map((entry) => {
    if (entry.type === "model_change") {
      const payload = entry.payload as { from_model?: unknown; to_model?: unknown };
      const next =
        prevModel !== undefined && payload.from_model === undefined
          ? { ...entry, payload: { ...entry.payload, from_model: prevModel } }
          : entry;
      if (typeof payload.to_model === "string") prevModel = payload.to_model;
      return next;
    }
    const model = hintOf(entry)?.model;
    if (model !== undefined) prevModel = model;
    return entry;
  });
};

/**
 * Append a synthesized `session_terminated` when the file ends with `tool_call`s
 * that never got a paired `tool_result` or call-scoped `tool_call_aborted` (spec §10.3 / §18.4). Ports v1
 * `buildSynthesizedSessionTerminated`; pairing uses rules A (`for_id`) and B
 * (`semantic.call_id`), matching the validator's blocking subset.
 */
export const piSessionTerminatedEof: ReconcilerRule = (entries) => {
  const toolCallEntryIds = new Set<string>();
  const callIdToEntryId = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== "tool_call") continue;
    toolCallEntryIds.add(entry.id);
    const callId = entry.semantic?.call_id;
    if (typeof callId === "string") callIdToEntryId.set(callId, entry.id);
  }
  if (toolCallEntryIds.size === 0) return entries;

  const matched = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "tool_result" && entry.type !== "tool_call_aborted") continue;
    if (
      entry.type === "tool_call_aborted" &&
      (entry.payload as { scope?: unknown }).scope !== "tool_call"
    ) {
      continue;
    }
    const forId = (entry.payload as { for_id?: unknown }).for_id;
    if (typeof forId === "string" && toolCallEntryIds.has(forId)) matched.add(forId);
    if (entry.type !== "tool_result") continue;
    const callId = entry.semantic?.call_id;
    if (typeof callId === "string") {
      const eid = callIdToEntryId.get(callId);
      if (eid !== undefined) matched.add(eid);
    }
  }

  const openCallIds = Array.from(toolCallEntryIds).filter((id) => !matched.has(id));
  if (openCallIds.length === 0) return entries;

  // The id is seeded from openCallIds, which are themselves sessionUid-derived
  // engine ids ([sessionUid, recordIndex, type, ordinal]) — so the synthesized
  // id is already session-scoped and deterministic without threading sessionUid
  // into the reconciler context.

  const lastEntry = entries[entries.length - 1];
  const schemaVersion = entries.find((e) => typeof e.source?.schema_version === "string")?.source
    ?.schema_version;
  const synthesized: Entry = {
    type: "session_terminated",
    id: deriveSynthesizedEntryId(PI_ENTRY_ID_NAMESPACE, ["session_terminated_eof", ...openCallIds]),
    ts: lastEntry?.ts ?? "",
    payload: { reason: "eof_with_open_tool_calls", open_call_ids: openCallIds },
    source: {
      agent: "pi",
      ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
      synthesized: true,
    },
  };
  return [...entries, synthesized];
};
