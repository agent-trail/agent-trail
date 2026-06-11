import type { MappingDef } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { mcpCapabilityMappings, sessionCapabilityMappings } from "./mappings/capabilities.ts";
import { diagnosticMappings } from "./mappings/diagnostics.ts";
import { lifecycleMappings } from "./mappings/lifecycle.ts";
import { messageMappings } from "./mappings/messages.ts";
import {
  compactedSourceRaw,
  emittable,
  meta,
  payloadOf,
  type Raw,
  source,
} from "./mappings/shared.ts";
import { toolMappings } from "./mappings/tools.ts";
import { codexUsageFromTokenCount } from "./parser.ts";
import { numericValue, stringValue } from "./source.ts";

export { IMAGE_CARRIER, INLINE_IMAGE_MAX_DECODED_BYTES } from "./mappings/messages.ts";

/**
 * Private meta key on a transient pass-1 carrier `system_event`: token_count maps
 * to a carrier holding the mapped usage here, and `codexTokenRollup` folds it into
 * the preceding agent_message's `payload.usage` then drops the carrier. The final
 * trail never contains the carrier or this key.
 */
export const USAGE_CARRIER = "x-codex/_usage";
export const TOKEN_MODEL_CARRIER = "x-codex/_token_model";

const compacted = defineMapping<Raw>({
  match: { type: "compacted" },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    // Canonical compaction summary is `payload.message` (CompactedItem.message);
    // observed real values can be empty, so default to "" (drift-defense: no
    // `summary` fallback).
    const summary = stringValue(p.message) ?? "";
    const payload: Raw = { summary, trigger: "auto" };
    const tokensBefore = numericValue(p.tokens_before);
    if (tokensBefore !== undefined) payload.tokens_before = Math.trunc(tokensBefore);
    const tokensAfter = numericValue(p.tokens_after);
    if (tokensAfter !== undefined) payload.tokens_after = Math.trunc(tokensAfter);
    return [
      {
        type: "context_compact",
        payload,
        source: source("compacted", compactedSourceRaw(record)),
        meta: meta("compacted"),
      },
    ];
  },
});

const tokenCount = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "token_count" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const payload = payloadOf(record);
    const usage = codexUsageFromTokenCount(payload);
    const info =
      typeof payload.info === "object" && payload.info !== null ? (payload.info as Raw) : {};
    const model =
      stringValue(payload.model) ??
      stringValue(info.model) ??
      stringValue(info.model_id) ??
      stringValue(info.modelId);
    if (usage === undefined && model === undefined) return [];
    // Transient carrier folded into the preceding agent_message by
    // codexTokenRollup, then dropped.
    return [
      {
        type: "system_event",
        payload: { kind: USAGE_CARRIER },
        meta: {
          ...(usage !== undefined ? { [USAGE_CARRIER]: usage } : {}),
          ...(model !== undefined ? { [TOKEN_MODEL_CARRIER]: model } : {}),
        },
      },
    ];
  },
});

// Intentionally NOT mapped (recognized by the codex/v0.135 schema so they are not
// quarantined, and dropped because they duplicate already-captured records):
//   - response_item.message (text-only) — duplicates event_msg.{user,agent}_message.
//   - event_msg.context_compacted — duplicates the top-level `compacted` record.
export const codexMappings: MappingDef<Raw>[] = [
  ...sessionCapabilityMappings,
  ...messageMappings,
  ...toolMappings,
  compacted,
  tokenCount,
  ...diagnosticMappings,
  ...lifecycleMappings,
  ...mcpCapabilityMappings,
];
