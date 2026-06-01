// Claude Code is linear (parentChain handles parent_id). These custom rules cover
// the cross-record behaviors the kit's per-record mappings can't express:
// synthesized model_change (assistant model transitions), permission-mode deltas,
// tool_kind propagation to results, and multi-block source.raw.envelope_ref
// backfill + hint stripping. ccEnvelopeRefBackfill runs LAST (it strips hints).
import type { ReconcilerRule } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import { CLAUDE_CODE_ENTRY_ID_NAMESPACE, deriveSynthesizedEntryId } from "../session-uid.ts";
import { type CcHint, HINT } from "./mappings.ts";

function hintOf(entry: Entry): CcHint | undefined {
  return entry.meta?.[HINT] as CcHint | undefined;
}

function linkerCallId(entry: Entry): string | undefined {
  const linker = entry.meta?.linker;
  if (linker === null || typeof linker !== "object") return undefined;
  const callId = (linker as Record<string, unknown>).call_id;
  return typeof callId === "string" ? callId : undefined;
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
  const queryByCallId = new Map<string, Entry>();
  for (const entry of entries) {
    if (entry.type === "tool_call") {
      const kind = entry.semantic?.tool_kind;
      if (kind !== undefined) kindByCallEntryId.set(entry.id, kind);
    }
    if (entry.type === "user_query") {
      const callId = entry.semantic?.call_id ?? linkerCallId(entry);
      if (callId !== undefined) queryByCallId.set(callId, entry);
    }
  }
  return entries.map((entry) => {
    if (entry.type !== "tool_result") return entry;
    const callId = entry.semantic?.call_id ?? linkerCallId(entry);
    const query = callId !== undefined ? queryByCallId.get(callId) : undefined;
    if (query !== undefined) {
      return {
        ...entry,
        type: "user_query_response",
        payload: {
          for_id: query.id,
          answers: answersForQuery(query, (entry.payload as { output?: unknown }).output),
        },
        semantic: {
          ...(callId !== undefined ? { call_id: callId } : {}),
        },
      } as Entry;
    }
    const forId = (entry.payload as { for_id?: unknown }).for_id;
    if (typeof forId !== "string") return entry;
    const kind = kindByCallEntryId.get(forId);
    if (kind === undefined) return entry;
    return { ...entry, semantic: { ...entry.semantic, tool_kind: kind } };
  });
};

function queryQuestions(entry: Entry): Record<string, unknown>[] {
  const questions = (entry.payload as { questions?: unknown }).questions;
  return Array.isArray(questions)
    ? questions.filter(
        (question): question is Record<string, unknown> =>
          question !== null && typeof question === "object",
      )
    : [];
}

function unescapeQuoted(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function parseSerializedAnswers(output: unknown): Map<string, string> {
  const answers = new Map<string, string>();
  if (typeof output !== "string" || output.length === 0) return answers;
  const pairPattern = /"((?:\\.|[^"\\])*)"="((?:\\.|[^"\\])*)"/g;
  for (const match of output.matchAll(pairPattern)) {
    const question = match[1] as string;
    const answer = match[2] as string;
    answers.set(unescapeQuoted(question), unescapeQuoted(answer));
  }
  if (answers.size === 0) answers.set("", output);
  return answers;
}

function selectedFor(
  question: Record<string, unknown>,
  answerText: string,
): Record<string, unknown> {
  const selected =
    question.multi_select === true
      ? answerText
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : answerText.length > 0
        ? [answerText]
        : [];
  const optionLabels = new Set(
    (Array.isArray(question.options) ? question.options : [])
      .filter(
        (option): option is Record<string, unknown> =>
          option !== null && typeof option === "object",
      )
      .map((option) => option.label)
      .filter((label): label is string => typeof label === "string"),
  );
  if (question.allow_other !== true || optionLabels.size === 0) return { selected };
  const known = selected.filter((value) => optionLabels.has(value));
  const unknown = selected.filter((value) => !optionLabels.has(value));
  return { selected: known, ...(unknown.length > 0 ? { other: unknown.join(", ") } : {}) };
}

function answersForQuery(query: Entry, output: unknown): Record<string, unknown> {
  const serialized = parseSerializedAnswers(output);
  if (serialized.size === 0) return {};
  const questions = queryQuestions(query);
  const fallback = questions.length === 1 && serialized.has("") ? serialized.get("") : undefined;
  const textCounts = new Map<string, number>();
  for (const question of questions) {
    const text = typeof question.question === "string" ? question.question : undefined;
    if (text !== undefined) textCounts.set(text, (textCounts.get(text) ?? 0) + 1);
  }
  const out: Record<string, unknown> = {};
  for (const question of questions) {
    const id = typeof question.id === "string" ? question.id : undefined;
    const text = typeof question.question === "string" ? question.question : undefined;
    if (id === undefined) continue;
    const answerText =
      (text !== undefined && textCounts.get(text) === 1 ? serialized.get(text) : undefined) ??
      fallback;
    if (answerText !== undefined) out[id] = selectedFor(question, answerText);
  }
  return out;
}

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
