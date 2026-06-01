import type { ReconcilerRule } from "@agent-trail/adapter-kit";
import type { AgentMessageUsage, Attachment, Entry } from "@agent-trail/types";
import { IMAGE_CARRIER, USAGE_CARRIER } from "./mappings.ts";

function usageCarrier(entry: Entry): AgentMessageUsage | undefined {
  const value = (entry.meta as Record<string, unknown> | undefined)?.[USAGE_CARRIER];
  return value as AgentMessageUsage | undefined;
}

type CarriedImages = { role?: string; text: string; attachments: Attachment[] };

function imageCarrier(entry: Entry): CarriedImages | undefined {
  const value = (entry.meta as Record<string, unknown> | undefined)?.[IMAGE_CARRIER];
  return value as CarriedImages | undefined;
}

const normalizeText = (text: string): string => text.replace(/\s+/g, " ").trim();

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
    .map(imageCarrier)
    .filter((c): c is CarriedImages => c !== undefined)
    .map((c) => ({
      type: c.role === "assistant" ? ("agent_message" as const) : ("user_message" as const),
      text: normalizeText(c.text),
      attachments: c.attachments,
      used: false,
    }));

  const out: Entry[] = [];
  for (const entry of entries) {
    if (imageCarrier(entry) !== undefined) continue; // drop the carrier
    if (entry.type === "user_message" || entry.type === "agent_message") {
      const text = normalizeText(String((entry.payload as { text?: unknown }).text ?? ""));
      const match = carriers.find((c) => !c.used && c.type === entry.type && c.text === text);
      if (match !== undefined) {
        match.used = true;
        out.push({ ...entry, payload: { ...entry.payload, attachments: match.attachments } });
        continue;
      }
    }
    out.push(entry);
  }

  // Safety net: a carrier that matched no message still surfaces, so the image is
  // never dropped silently (text-required payload, so use the carried text).
  for (const c of carriers) {
    if (c.used) continue;
    out.push({
      type: c.type,
      payload: { text: c.text, attachments: c.attachments },
      source: { agent: "codex-cli", original_type: "response_item.message" },
    } as Entry);
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
