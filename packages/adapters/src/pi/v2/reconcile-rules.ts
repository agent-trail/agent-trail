// Pi-specific pass-2 reconciler rules. Pi is tree-native and synthesizes entries
// that the kit's per-record mappings can't express, and the kit's general
// `branchReconciliation` is deferred (#135) — so these custom rules stand in for
// it. Order matters and is fixed in adapter.ts: piModelChangeFromModel runs first
// (it reads the assistant model off the parenting hint, which piParentResolution
// later strips), then piToolKindToResult, piParentResolution, piSessionTerminatedEof.
import type { ReconcilerRule } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import { type ParentableEntry, resolveEntryParents } from "../../parenting.ts";
import { deriveSynthesizedEntryId, PI_ENTRY_ID_NAMESPACE } from "../../session-uid.ts";
import { findAbandonedBranchRootId } from "../divergence.ts";
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

/**
 * Pi tree-topology pass (replaces the deferred kit `branchReconciliation`).
 * Rebuilds the source-id → entry-id maps from the `PARENT_HINT` stashed by the
 * mappings, fills `parent_id` (intra-envelope block chains honored), resolves
 * each `branch_summary.abandoned_branch_id` via the divergence walk, then strips
 * the transient hints. Mirrors v1 `parsePiJsonl` parenting + `divergence.ts`.
 */
export const piParentResolution: ReconcilerRule = (entries) => {
  const parentBySourceId = new Map<string, string | null>();
  const sourceIdToFirstEntryId = new Map<string, string>();
  const sourceIdToLastEntryId = new Map<string, string>();
  const lastEntryIdForSid = new Map<string, string>();

  for (const entry of entries) {
    const hint = hintOf(entry);
    if (hint === undefined) continue;
    if (!parentBySourceId.has(hint.sid)) parentBySourceId.set(hint.sid, hint.pid);
    if (!sourceIdToFirstEntryId.has(hint.sid)) sourceIdToFirstEntryId.set(hint.sid, entry.id);
    sourceIdToLastEntryId.set(hint.sid, entry.id);
  }

  const built: ParentableEntry[] = entries.map((entry) => {
    const hint = hintOf(entry);
    if (hint === undefined) return { entry, parentSourceId: null };
    // Within one source envelope (multi-block assistant), each block after the
    // first chains off the previous block's entry. Safe regardless of other
    // entries interleaving: the kit emits one record's drafts contiguously and
    // this map is keyed by source id, so only same-envelope blocks chain here.
    const localParentId = lastEntryIdForSid.get(hint.sid);
    lastEntryIdForSid.set(hint.sid, entry.id);
    return { entry, parentSourceId: hint.pid, localParentId };
  });

  const parented = resolveEntryParents(built, parentBySourceId, sourceIdToLastEntryId);

  return parented.map((entry) => {
    const hint = hintOf(entry);
    let next = entry;
    if (hint?.fromId !== undefined && entry.type === "branch_summary") {
      const activeLeaf = typeof hint.pid === "string" ? hint.pid : undefined;
      const resolved = findAbandonedBranchRootId(
        hint.fromId,
        activeLeaf,
        parentBySourceId,
        sourceIdToFirstEntryId,
      );
      next = {
        ...entry,
        payload: { ...entry.payload, abandoned_branch_id: resolved },
      };
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
  };
}

/**
 * Copy `semantic.tool_kind` from each `tool_call` onto its linked `tool_result`
 * (linked by `payload.for_id`, set by the built-in `toolLinking` pass). v1
 * carries the call's canonical tool kind on the result; the kit does not.
 */
export const piToolKindToResult: ReconcilerRule = (entries) => {
  const toolKindByCallEntryId = new Map<string, ToolKind>();
  for (const entry of entries) {
    if (entry.type !== "tool_call") continue;
    const kind = entry.semantic?.tool_kind;
    if (kind !== undefined) toolKindByCallEntryId.set(entry.id, kind);
  }

  return entries.map((entry) => {
    if (entry.type !== "tool_result") return entry;
    const forId = (entry.payload as { for_id?: unknown }).for_id;
    if (typeof forId !== "string") return entry;
    const kind = toolKindByCallEntryId.get(forId);
    if (kind === undefined) return entry;
    return { ...entry, semantic: { ...entry.semantic, tool_kind: kind } };
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
 * that never got a paired `tool_result` (spec §9.3 / §16.4). Ports v1
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
    if (entry.type !== "tool_result") continue;
    const forId = (entry.payload as { for_id?: unknown }).for_id;
    if (typeof forId === "string" && toolCallEntryIds.has(forId)) matched.add(forId);
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
  } as Entry;
  return [...entries, synthesized];
};
