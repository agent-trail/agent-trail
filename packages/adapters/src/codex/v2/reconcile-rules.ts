import type { ReconcilerRule } from "@agent-trail/adapter-kit";
import type { AgentMessageUsage, Entry } from "@agent-trail/types";
import { USAGE_CARRIER } from "./mappings.ts";

function usageCarrier(entry: Entry): AgentMessageUsage | undefined {
  const value = (entry.meta as Record<string, unknown> | undefined)?.[USAGE_CARRIER];
  return value as AgentMessageUsage | undefined;
}

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
        const target = out[lastAgentMessageIndex] as Entry;
        out[lastAgentMessageIndex] = { ...target, payload: { ...target.payload, usage } };
      }
      continue; // drop the carrier
    }
    if (entry.type === "agent_message") lastAgentMessageIndex = out.length;
    else if (entry.type === "user_message") lastAgentMessageIndex = undefined;
    out.push(entry);
  }
  return out;
};
