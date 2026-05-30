import type { OverrideDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import type { Entry } from "@agent-trail/types";
import { AGENT_NAME, reasoningDedupKey } from "../parser.ts";
import { isObject, stringValue, timestampToIso } from "../source.ts";

type Raw = Record<string, unknown>;

/**
 * Shared pass-1 state for the Codex overrides (mirrors v1 `buildEntries` locals):
 * the last turn_context model (for synthesized model_change), the current turn id,
 * and the set of normalized reasoning keys already emitted this turn (for dedup).
 */
export interface CodexState {
  lastModel: string | undefined;
  currentTurnId: string;
  seen: Set<string>;
}

export function initialCodexState(): CodexState {
  return { lastModel: undefined, currentTurnId: "turn-implicit", seen: new Set<string>() };
}

function payloadOf(record: Raw): Raw {
  return isObject(record.payload) ? record.payload : {};
}

function emittable(record: Raw): boolean {
  return timestampToIso(record.timestamp) !== undefined;
}

function modelChangeDraft(fromModel: string | undefined, toModel: string): TrailEntryDraft {
  return {
    type: "model_change",
    payload: { to_model: toModel, ...(fromModel !== undefined ? { from_model: fromModel } : {}) },
    source: {
      agent: AGENT_NAME,
      original_type: "turn_context.model_change",
      synthesized: true,
    },
    meta: { "dev.codex.raw_type": "turn_context.model_change" },
  };
}

function thinkingDraft(text: string, rawType: string): TrailEntryDraft {
  return {
    type: "agent_thinking",
    payload: { text },
    source: { agent: AGENT_NAME, original_type: rawType },
    meta: { "dev.codex.raw_type": rawType },
  };
}

// turn_context emits no entry of its own, but resets the per-turn dedup set on a
// turn_id change and synthesizes a model_change when the model differs from the
// last seen one (spec §9.3). Mirrors v1 parser.ts lines 652-663.
const turnContext: OverrideDef<Raw, CodexState> = {
  match: { type: "turn_context" },
  emit: (record, ctx) => {
    // Matches v1: buildEntries skips the whole record (no turn reset, no model
    // tracking) when the timestamp is unparseable (`if (ts === undefined) continue`
    // before the turn_context branch), so state must NOT advance here either.
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const turnId = stringValue(p.turn_id);
    if (turnId !== undefined && turnId !== ctx.state.currentTurnId) {
      ctx.state.currentTurnId = turnId;
      ctx.state.seen = new Set<string>();
    }
    const model = stringValue(p.model);
    const drafts: TrailEntryDraft[] = [];
    if (model !== undefined) {
      if (ctx.state.lastModel !== undefined && ctx.state.lastModel !== model) {
        drafts.push(modelChangeDraft(ctx.state.lastModel, model));
      }
      ctx.state.lastModel = model;
    }
    return drafts;
  },
};

function dedupedThinking(
  text: string,
  rawType: string,
  ctx: { state: CodexState },
): TrailEntryDraft[] {
  const key = reasoningDedupKey(text);
  if (key.length === 0 || ctx.state.seen.has(key)) return [];
  ctx.state.seen.add(key);
  return [thinkingDraft(text, rawType)];
}

function eventReasoning(
  payloadType: "agent_reasoning" | "agent_reasoning_raw_content",
): OverrideDef<Raw, CodexState> {
  const rawType = `event_msg.${payloadType}`;
  return {
    match: { type: "event_msg", payload: { type: payloadType } },
    emit: (record, ctx) => {
      if (!emittable(record)) return [];
      const p = payloadOf(record);
      const text = stringValue(p.text) ?? stringValue(p.message);
      if (text === undefined || text.length === 0) return [];
      return dedupedThinking(text, rawType, ctx);
    },
  };
}

// response_item.reasoning carries an opaque encrypted blob and an optional
// plaintext `summary` array; emit agent_thinking only when the summary has text.
const responseReasoning: OverrideDef<Raw, CodexState> = {
  match: { type: "response_item", payload: { type: "reasoning" } },
  emit: (record, ctx) => {
    if (!emittable(record)) return [];
    const summary = payloadOf(record).summary;
    if (!Array.isArray(summary)) return [];
    const text = summary
      .filter(isObject)
      .map((item) => stringValue(item.text))
      .filter((t): t is string => t !== undefined && t.length > 0)
      .join("\n");
    if (text.length === 0) return [];
    return dedupedThinking(text, "response_item.reasoning.summary", ctx);
  },
};

export const codexOverrides: OverrideDef<Raw, CodexState>[] = [
  turnContext,
  eventReasoning("agent_reasoning"),
  eventReasoning("agent_reasoning_raw_content"),
  responseReasoning,
];
