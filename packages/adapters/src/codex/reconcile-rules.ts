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

function userInputAnswersFromOutput(output: unknown): unknown {
  if (typeof output !== "string") return undefined;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (parsed !== null && typeof parsed === "object" && "answers" in parsed) {
      return (parsed as { answers?: unknown }).answers;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function withUserInputAnswersMeta(entry: Entry, answers: unknown, kind: ToolKind): Entry {
  const payload = entry.payload as Record<string, unknown>;
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
        user_input_request: { ...(meta.user_input_request as object | undefined), answers },
      },
    },
  } as Entry;
}

export const codexUserInputAnswersMeta: ReconcilerRule = (entries) => {
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
    const answers = userInputAnswersFromOutput((entry.payload as { output?: unknown }).output);
    if (answers === undefined)
      return { ...entry, semantic: { ...entry.semantic, tool_kind: kind } };
    return withUserInputAnswersMeta(entry, answers, kind);
  });
};
