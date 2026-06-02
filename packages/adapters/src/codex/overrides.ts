import type { OverrideDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import {
  AGENT_NAME,
  permissionModeLabel,
  reasoningDedupKey,
  stableAxisKey,
  turnContextFlavorAxis,
  turnContextPermissionAxis,
} from "./parser.ts";
import { isObject, stringValue, timestampToIso } from "./source.ts";

type Raw = Record<string, unknown>;

/**
 * Shared pass-1 state for the Codex overrides (mirrors v1 `buildEntries` locals):
 * the last turn_context model (for synthesized model_change), the current turn id,
 * the set of normalized reasoning keys already emitted this turn (for dedup), and
 * the last-seen permission / flavor policy axes (for change-only system_events).
 */
export interface CodexState {
  lastModel: string | undefined;
  currentTurnId: string;
  seen: Set<string>;
  lastPermissionKey: string | undefined;
  lastPermissionMode: string | undefined;
  lastFlavorKey: string | undefined;
}

export function initialCodexState(): CodexState {
  return {
    lastModel: undefined,
    currentTurnId: "turn-implicit",
    seen: new Set<string>(),
    lastPermissionKey: undefined,
    lastPermissionMode: undefined,
    lastFlavorKey: undefined,
  };
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

// Permission axis change → reserved `permission_mode_change` so cross-adapter
// renderers surface Codex autonomy changes uniformly. `data.to`/`from` use the
// named preset (active_permission_profile / permission_profile) when present,
// else the raw approval policy; the full axis (sandbox / network / fs policy)
// rides alongside for fidelity.
function permissionModeChangeDraft(
  fromMode: string | undefined,
  axis: Raw,
  payload: Raw,
): TrailEntryDraft {
  const to = permissionModeLabel(payload);
  const data: Raw = { ...axis };
  if (to !== undefined) data.to = to;
  if (fromMode !== undefined) data.from = fromMode;
  return {
    type: "system_event",
    payload: { kind: "permission_mode_change", data },
    source: { agent: AGENT_NAME, original_type: "turn_context.permission", synthesized: true },
    meta: { "dev.codex.raw_type": "turn_context.permission" },
  };
}

// Flavor axis change (personality / collaboration_mode / effort) → vendor
// `x-codex/turn_context`; not a permission concern, so it stays out of the
// reserved kind.
function turnContextFlavorDraft(axis: Raw): TrailEntryDraft {
  return {
    type: "system_event",
    payload: { kind: "x-codex/turn_context", data: { ...axis } },
    source: { agent: AGENT_NAME, original_type: "turn_context.flavor", synthesized: true },
    meta: { "dev.codex.raw_type": "turn_context.flavor" },
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

// turn_context emits no entry of its own beyond synthesized signals: it resets
// the per-turn reasoning dedup set on a turn_id change, synthesizes a
// model_change when the model differs, and emits permission_mode_change /
// x-codex/turn_context system_events when those policy axes change. The first
// turn_context establishes each baseline silently (its full tuple is snapshotted
// into header.meta in index.ts), so only mid-session changes surface as events.
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
    const drafts: TrailEntryDraft[] = [];
    const model = stringValue(p.model);
    if (model !== undefined) {
      if (ctx.state.lastModel !== undefined && ctx.state.lastModel !== model) {
        drafts.push(modelChangeDraft(ctx.state.lastModel, model));
      }
      ctx.state.lastModel = model;
    }
    const permAxis = turnContextPermissionAxis(p);
    if (Object.keys(permAxis).length > 0) {
      const permKey = stableAxisKey(permAxis);
      if (ctx.state.lastPermissionKey !== undefined && ctx.state.lastPermissionKey !== permKey) {
        drafts.push(permissionModeChangeDraft(ctx.state.lastPermissionMode, permAxis, p));
      }
      ctx.state.lastPermissionKey = permKey;
      ctx.state.lastPermissionMode = permissionModeLabel(p);
    }
    const flavorAxis = turnContextFlavorAxis(p);
    if (Object.keys(flavorAxis).length > 0) {
      const flavorKey = stableAxisKey(flavorAxis);
      if (ctx.state.lastFlavorKey !== undefined && ctx.state.lastFlavorKey !== flavorKey) {
        drafts.push(turnContextFlavorDraft(flavorAxis));
      }
      ctx.state.lastFlavorKey = flavorKey;
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
      // Canonical reasoning text is `payload.text` (AgentReasoningEvent.text);
      // no `message` fallback (drift-defense: audited single source).
      const text = stringValue(p.text);
      if (text === undefined || text.length === 0) return [];
      return dedupedThinking(text, rawType, ctx);
    },
  };
}

// response_item.reasoning carries an opaque encrypted blob and an optional
// plaintext `summary` array. Each summary element is a distinct reasoning
// section (the boundaries the streaming `agent_reasoning_section_break` events
// delimit). Emit one agent_thinking record per section rather than joining with
// "\n" — section structure survives, and this matches how every other adapter
// records thinking blocks. Per-section dedup (shared `seen`) folds the duplicate
// streaming `event_msg.agent_reasoning` sections while letting divergent ones
// through.
const responseReasoning: OverrideDef<Raw, CodexState> = {
  match: { type: "response_item", payload: { type: "reasoning" } },
  emit: (record, ctx) => {
    if (!emittable(record)) return [];
    const summary = payloadOf(record).summary;
    if (!Array.isArray(summary)) return [];
    const drafts: TrailEntryDraft[] = [];
    for (const item of summary) {
      if (!isObject(item)) continue;
      const text = stringValue(item.text);
      if (text === undefined || text.length === 0) continue;
      drafts.push(...dedupedThinking(text, "response_item.reasoning.summary", ctx));
    }
    return drafts;
  },
};

export const codexOverrides: OverrideDef<Raw, CodexState>[] = [
  turnContext,
  eventReasoning("agent_reasoning"),
  eventReasoning("agent_reasoning_raw_content"),
  responseReasoning,
];
