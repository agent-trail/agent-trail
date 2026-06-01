// Claude Code is linear (parentChain handles parent_id). These custom rules cover
// the cross-record behaviors the kit's per-record mappings can't express:
// synthesized model_change (assistant model transitions), permission-mode deltas,
// tool_kind propagation to results, and multi-block source.raw.envelope_ref
// backfill + hint stripping. ccEnvelopeRefBackfill runs LAST (it strips hints).
import type { ReconcilerRule } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import { CLAUDE_CODE_ENTRY_ID_NAMESPACE, deriveSynthesizedEntryId } from "../session-uid.ts";
import { dropTaskPlanAckResults, withTaskPlanDeltas } from "../task-plan.ts";
import { type CcHint, HINT } from "./mappings.ts";

const USER_INPUT_ANSWERS_META_MAX_BYTES = 10_240;
const TEXT_ENCODER = new TextEncoder();

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function hintOf(entry: Entry): CcHint | undefined {
  return entry.meta?.[HINT] as CcHint | undefined;
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
        const envelope = entry.source?.raw?.envelope;
        const schemaVersion = entry.source?.schema_version;
        const source = {
          agent: "claude-code",
          original_type: "assistant",
          ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
          synthesized: true,
          ...(envelope !== undefined ? { raw: envelope } : {}),
        } as Entry["source"];
        const modelChangeId = deriveSynthesizedEntryId(CLAUDE_CODE_ENTRY_ID_NAMESPACE, [
          "model_change",
          entry.id,
          prevModel,
          model,
        ]);
        out.push({
          type: "model_change",
          id: modelChangeId,
          ts: entry.ts,
          parent_id: entry.parent_id ?? null,
          payload: { from_model: prevModel, to_model: model },
          source,
        } as Entry);
        out.push({ ...entry, parent_id: modelChangeId });
        prevModel = model;
        lastSid = sid;
        continue;
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
    if (kind !== "user_input_request") {
      return { ...entry, semantic: { ...entry.semantic, tool_kind: kind } };
    }
    const payload = entry.payload as Record<string, unknown>;
    const output = typeof payload.output === "string" ? payload.output : undefined;
    if (output === undefined) return { ...entry, semantic: { ...entry.semantic, tool_kind: kind } };
    if (byteLength(output) > USER_INPUT_ANSWERS_META_MAX_BYTES) {
      return { ...entry, semantic: { ...entry.semantic, tool_kind: kind } };
    }
    const meta =
      payload.meta !== null && typeof payload.meta === "object"
        ? (payload.meta as Record<string, unknown>)
        : {};
    return {
      ...entry,
      semantic: { ...entry.semantic, tool_kind: kind },
      payload: {
        ...payload,
        meta: {
          ...meta,
          user_input_request: {
            ...(meta.user_input_request as object | undefined),
            answers: output,
          },
        },
      },
    } as Entry;
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
    const payload = entry.payload as { kind?: unknown; data?: Record<string, unknown> };
    if (payload.kind !== "permission_mode_change") return entry;
    const mode = typeof payload.data?.to === "string" ? payload.data.to : undefined;
    if (mode === undefined) return entry;
    let next = entry;
    if (prevMode !== undefined && prevMode !== mode) {
      next = {
        ...entry,
        payload: {
          ...payload,
          text: `Permission mode changed: ${prevMode} → ${mode}`,
          data: { ...payload.data, from: prevMode },
        },
      };
    }
    prevMode = mode;
    return next;
  });
};

export const ccTaskPlanDeltas: ReconcilerRule = (entries) => withTaskPlanDeltas(entries);

export const ccDropTaskPlanResults: ReconcilerRule = (entries) => dropTaskPlanAckResults(entries);

function stripHint(entry: Entry): Entry {
  const m = entry.meta as Record<string, unknown> | undefined;
  if (m === undefined || !(HINT in m)) return entry;
  const { [HINT]: _drop, ...rest } = m;
  // v1 Claude Code entries carry no entry-level meta — drop it when only the
  // (now-removed) hint remained.
  if (Object.keys(rest).length > 0) return { ...entry, meta: rest };
  const { meta: _meta, ...withoutMeta } = entry;
  return withoutMeta as Entry;
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
    const raw = entry.source?.raw;
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
