import type { ReconcilerRule } from "@agent-trail/adapter-kit";
import type { AgentMessageUsage, Attachment, Entry, ToolKind } from "@agent-trail/types";
import { IMAGE_CARRIER, USAGE_CARRIER } from "./mappings.ts";

function usageCarrier(entry: Entry): AgentMessageUsage | undefined {
  const value = (entry.meta as Record<string, unknown> | undefined)?.[USAGE_CARRIER];
  return value as AgentMessageUsage | undefined;
}

type CarriedImages = { role?: string; text: string; attachments: Attachment[] };
type MessageType = "user_message" | "agent_message";
type Carrier = CarriedImages & {
  entry: Entry;
  index: number;
  type: MessageType;
  matchText: string;
  used: boolean;
};
type MessageCandidate = { index: number; type: MessageType; text: string; used: boolean };

function imageCarrier(entry: Entry): CarriedImages | undefined {
  const value = (entry.meta as Record<string, unknown> | undefined)?.[IMAGE_CARRIER];
  return value as CarriedImages | undefined;
}

const normalizeText = (text: string): string => text.replace(/\s+/g, " ").trim();

function withoutImageCarrierMeta(entry: Entry): Entry["meta"] | undefined {
  const meta = entry.meta as Record<string, unknown> | undefined;
  if (meta === undefined) return undefined;
  const out = { ...meta };
  delete out[IMAGE_CARRIER];
  return Object.keys(out).length > 0 ? out : undefined;
}

function fallbackFromCarrier(carrier: Carrier): Entry {
  const fallback = {
    ...carrier.entry,
    type: carrier.type,
    payload: { text: carrier.text, attachments: carrier.attachments },
  } as Entry;
  const meta = withoutImageCarrierMeta(carrier.entry);
  if (meta === undefined) delete (fallback as { meta?: unknown }).meta;
  else fallback.meta = meta;
  return fallback;
}

/**
 * Fold the images from each image-bearing `response_item.message` (carried as a
 * transient IMAGE_CARRIER by the mapping) into the `attachments` of the matching
 * `user_message`/`agent_message` — whose text is the `event_msg` echo of the same
 * turn — then drop the carriers. Matched by role-derived type + normalized text
 * (each carrier consumed once). A carrier with no match is emitted as a standalone
 * message so the image is never silently lost.
 */
export const codexImageRollup: ReconcilerRule = (entries) => {
  const carriers = entries
    .map((entry, index) => ({ entry, index, carried: imageCarrier(entry) }))
    .filter(
      (c): c is { entry: Entry; index: number; carried: CarriedImages } => c.carried !== undefined,
    )
    .map(
      (c): Carrier => ({
        ...c.carried,
        entry: c.entry,
        index: c.index,
        type: c.carried.role === "assistant" ? "agent_message" : "user_message",
        text: c.carried.text,
        matchText: normalizeText(c.carried.text),
        attachments: c.carried.attachments,
        used: false,
      }),
    );
  const messages: MessageCandidate[] = entries
    .map((entry, index) => ({ entry, index }))
    .filter(
      (candidate): candidate is { entry: Entry & { type: MessageType }; index: number } =>
        candidate.entry.type === "user_message" || candidate.entry.type === "agent_message",
    )
    .map(({ entry, index }) => ({
      index,
      type: entry.type,
      text: normalizeText(String((entry.payload as { text?: unknown }).text ?? "")),
      used: false,
    }));
  const assignments = new Map<number, Carrier>();

  for (const carrier of carriers) {
    const match = messages
      .filter((m) => !m.used && m.type === carrier.type && m.text === carrier.matchText)
      .sort((a, b) => Math.abs(a.index - carrier.index) - Math.abs(b.index - carrier.index))[0];
    if (match !== undefined) {
      match.used = true;
      carrier.used = true;
      assignments.set(match.index, carrier);
    }
  }

  const out: Entry[] = [];
  for (const [index, entry] of entries.entries()) {
    if (imageCarrier(entry) !== undefined) {
      const carrier = carriers.find((c) => c.index === index);
      if (carrier !== undefined && !carrier.used) out.push(fallbackFromCarrier(carrier));
      continue; // matched carriers are folded into their target message
    }
    const carrier = assignments.get(index);
    if (carrier !== undefined) {
      out.push({ ...entry, payload: { ...entry.payload, attachments: carrier.attachments } });
      continue;
    }
    out.push(entry);
  }
  return out;
};

/**
 * Fold each `event_msg.token_count` (carried as a transient USAGE_CARRIER
 * system_event by the mapping) into the `payload.usage` of the agent_message it
 * belongs to, then drop the carriers. Binding mirrors v1: the most recent
 * agent_message, reset on user_message, persisting across intervening tool_call /
 * tool_result records (a turn can interleave tools before the trailing count).
 */
export const codexTokenRollup: ReconcilerRule = (entries) => {
  let lastAgentMessageIndex: number | undefined;
  const out: Entry[] = [];
  for (const entry of entries) {
    const usage = usageCarrier(entry);
    if (usage !== undefined) {
      if (lastAgentMessageIndex !== undefined) {
        const target = out[lastAgentMessageIndex];
        if (target !== undefined) {
          out[lastAgentMessageIndex] = { ...target, payload: { ...target.payload, usage } };
        }
      }
      continue; // drop the carrier
    }
    if (entry.type === "agent_message") lastAgentMessageIndex = out.length;
    else if (entry.type === "user_message") lastAgentMessageIndex = undefined;
    out.push(entry);
  }
  return out;
};

function linkerCallId(entry: Entry): string | undefined {
  const linker = (entry.meta as { linker?: unknown } | undefined)?.linker;
  if (linker === null || typeof linker !== "object") return undefined;
  const callId = (linker as { call_id?: unknown }).call_id;
  return typeof callId === "string" ? callId : undefined;
}

function parsedAnswers(output: unknown): Record<string, unknown> {
  if (typeof output !== "string") return {};
  try {
    const parsed = JSON.parse(output) as unknown;
    const answers =
      parsed !== null && typeof parsed === "object"
        ? (parsed as { answers?: unknown }).answers
        : undefined;
    return answers !== null && typeof answers === "object" && !Array.isArray(answers)
      ? (answers as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function selectedValues(answer: unknown): string[] {
  if (typeof answer === "string") return [answer];
  if (Array.isArray(answer))
    return answer.filter((value): value is string => typeof value === "string");
  if (answer !== null && typeof answer === "object") {
    const objectAnswer = answer as { answers?: unknown; selected?: unknown };
    if (Array.isArray(objectAnswer.answers)) {
      return objectAnswer.answers.filter((value): value is string => typeof value === "string");
    }
    if (Array.isArray(objectAnswer.selected)) {
      return objectAnswer.selected.filter((value): value is string => typeof value === "string");
    }
  }
  return [];
}

function otherValue(answer: unknown): string | undefined {
  if (answer !== null && typeof answer === "object") {
    const other = (answer as { other?: unknown }).other;
    return typeof other === "string" ? other : undefined;
  }
  return undefined;
}

function queryQuestions(entry: Entry): Record<string, unknown>[] {
  const questions = (entry.payload as { questions?: unknown }).questions;
  return Array.isArray(questions)
    ? questions.filter((q): q is Record<string, unknown> => q !== null && typeof q === "object")
    : [];
}

function normalizeAnswers(
  query: Entry,
  rawAnswers: Record<string, unknown>,
): Record<string, unknown> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const question of queryQuestions(query)) {
    const id = question.id;
    if (typeof id === "string") byId.set(id, question);
  }
  const out: Record<string, unknown> = {};
  for (const [questionId, rawAnswer] of Object.entries(rawAnswers)) {
    const question = byId.get(questionId);
    if (question === undefined) continue;
    const selected = selectedValues(rawAnswer);
    const optionLabels = new Set(
      (Array.isArray(question?.options) ? question.options : [])
        .filter(
          (option): option is Record<string, unknown> =>
            option !== null && typeof option === "object",
        )
        .map((option) => option.label)
        .filter((label): label is string => typeof label === "string"),
    );
    const allowOther = question?.allow_other === true;
    const known =
      optionLabels.size > 0 ? selected.filter((value) => optionLabels.has(value)) : selected;
    const unknown =
      optionLabels.size > 0 ? selected.filter((value) => !optionLabels.has(value)) : [];
    const answer: Record<string, unknown> = { selected: allowOther ? known : selected };
    const other = otherValue(rawAnswer);
    if (allowOther) {
      const otherParts = [...(other !== undefined && other.length > 0 ? [other] : []), ...unknown];
      if (otherParts.length > 0) answer.other = otherParts.join(", ");
    }
    out[questionId] = answer;
  }
  return out;
}

export const codexUserQueryResponses: ReconcilerRule = (entries) => {
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
          answers: normalizeAnswers(
            query,
            parsedAnswers((entry.payload as { output?: unknown }).output),
          ),
        },
        semantic: {
          ...(entry.semantic?.call_id !== undefined ? { call_id: entry.semantic.call_id } : {}),
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
