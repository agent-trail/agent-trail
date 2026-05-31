// Claude Code is linear (parentChain handles parent_id). These custom rules cover
// the cross-record behaviors the kit's per-record mappings can't express:
// synthesized model_change (assistant model transitions), permission-mode deltas,
// tool_kind propagation to results, and multi-block source.raw.envelope_ref
// backfill + hint stripping. ccEnvelopeRefBackfill runs LAST (it strips hints).
import type { ReconcilerRule } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import { CLAUDE_CODE_ENTRY_ID_NAMESPACE, deriveSynthesizedEntryId } from "../../session-uid.ts";
import { type CcHint, HINT } from "./mappings.ts";

function hintOf(entry: Entry): CcHint | undefined {
  return (entry.meta as Record<string, unknown> | undefined)?.[HINT] as CcHint | undefined;
}

/**
 * Insert a synthesized model_change when a new assistant envelope's model differs
 * from the previous one. Mirrors v1: per source assistant envelope (grouped by
 * hint.sid), reading the model off hint.model — so tool-only / thinking-only
 * assistants still trigger it. Runs before ccEnvelopeRefBackfill strips hints.
 */
export const ccModelChangeSynth: ReconcilerRule = (entries) => {
  let prevModel: string | undefined;
  let lastSid: string | undefined;
  const out: Entry[] = [];
  for (const entry of entries) {
    const hint = hintOf(entry);
    const model = hint?.model;
    const sid = hint?.sid;
    if (model !== undefined && sid !== undefined && sid !== lastSid) {
      if (prevModel !== undefined && prevModel !== model) {
        // v1 synthesizes from the assistant envelope: source agent/original_type
        // "assistant" + the redacted envelope (carried on the first assistant
        // entry's source.raw.envelope) under source.raw, synthesized.
        const envelope = (entry.source?.raw as { envelope?: unknown } | undefined)?.envelope;
        const schemaVersion = entry.source?.schema_version;
        const source = {
          agent: "claude-code",
          original_type: "assistant",
          ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
          synthesized: true,
          ...(envelope !== undefined ? { raw: envelope } : {}),
        } as Entry["source"];
        out.push({
          type: "model_change",
          id: deriveSynthesizedEntryId(CLAUDE_CODE_ENTRY_ID_NAMESPACE, [
            "model_change",
            entry.id,
            prevModel,
            model,
          ]),
          ts: entry.ts,
          parent_id: entry.parent_id ?? null,
          payload: { from_model: prevModel, to_model: model },
          source,
        } as Entry);
      }
      prevModel = model;
      lastSid = sid;
    }
    out.push(entry);
  }
  return out;
};

/**
 * Copy `semantic.tool_kind` from each tool_call onto its linked tool_result
 * (linked by payload.for_id from the built-in toolLinking pass). Same as Pi.
 */
export const ccToolKindToResult: ReconcilerRule = (entries) => {
  const kindByCallEntryId = new Map<string, ToolKind>();
  for (const entry of entries) {
    if (entry.type !== "tool_call") continue;
    const kind = entry.semantic?.tool_kind;
    if (kind !== undefined) kindByCallEntryId.set(entry.id, kind);
  }
  return entries.map((entry) => {
    if (entry.type !== "tool_result") return entry;
    const forId = (entry.payload as { for_id?: unknown }).for_id;
    if (typeof forId !== "string") return entry;
    const kind = kindByCallEntryId.get(forId);
    if (kind === undefined) return entry;
    return { ...entry, semantic: { ...entry.semantic, tool_kind: kind } };
  });
};

/**
 * Fill `permission_mode_change` `data.from` and the delta `text` from the prior
 * permission mode, in source order. Mappings emit only `data.to` + base text.
 */
export const ccPermissionModeDelta: ReconcilerRule = (entries) => {
  let prevMode: string | undefined;
  return entries.map((entry) => {
    if (entry.type !== "system_event") return entry;
    const payload = entry.payload as { kind?: unknown; data?: { to?: unknown } };
    if (payload.kind !== "permission_mode_change") return entry;
    const mode = typeof payload.data?.to === "string" ? payload.data.to : undefined;
    if (mode === undefined) return entry;
    let next = entry;
    if (prevMode !== undefined && prevMode !== mode) {
      next = {
        ...entry,
        payload: {
          ...entry.payload,
          text: `Permission mode changed: ${prevMode} → ${mode}`,
          data: { ...(entry.payload.data as object), from: prevMode },
        },
      };
    }
    prevMode = mode;
    return next;
  });
};

function stripHint(entry: Entry): Entry {
  const m = entry.meta as Record<string, unknown> | undefined;
  if (m === undefined || !(HINT in m)) return entry;
  const { [HINT]: _drop, ...rest } = m;
  // v1 Claude Code entries carry no entry-level meta — drop it when only the
  // (now-removed) hint remained.
  return Object.keys(rest).length > 0 ? { ...entry, meta: rest } : { ...entry, meta: undefined };
}

/**
 * Backfill multi-block `source.raw.envelope_ref` (placeholder until now) to the
 * first entry id of the same source envelope (grouped by hint.sid), then strip
 * the transient hints.
 */
export const ccEnvelopeRefBackfill: ReconcilerRule = (entries) => {
  const firstEntryIdForSid = new Map<string, string>();
  for (const entry of entries) {
    const sid = hintOf(entry)?.sid;
    if (sid !== undefined && !firstEntryIdForSid.has(sid)) firstEntryIdForSid.set(sid, entry.id);
  }
  return entries.map((entry) => {
    const sid = hintOf(entry)?.sid;
    const raw = (entry.source as { raw?: Record<string, unknown> } | undefined)?.raw;
    let next = entry;
    if (sid !== undefined && raw !== undefined && "envelope_ref" in raw) {
      const firstId = firstEntryIdForSid.get(sid);
      if (firstId !== undefined) {
        next = {
          ...entry,
          source: { ...entry.source, raw: { ...raw, envelope_ref: firstId } } as Entry["source"],
        };
      }
    }
    return stripHint(next);
  });
};
