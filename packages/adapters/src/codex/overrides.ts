import type { OverrideDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import {
  AGENT_NAME,
  permissionModeLabel,
  reasoningDedupKey,
  stableAxisKey,
  turnContextExecutionAxis,
  turnContextPermissionAxis,
} from "./parser.ts";
import { isObject, stringValue, timestampToIso } from "./source.ts";

type Raw = Record<string, unknown>;

/**
 * Shared pass-1 state for the Codex overrides (mirrors v1 `buildEntries` locals):
 * the last turn_context model (for synthesized model_change), the current turn id,
 * the set of normalized reasoning keys already emitted this turn (for dedup), and
 * the last-seen mode / thinking axes.
 */
export interface CodexState {
  lastModel: string | undefined;
  currentTurnId: string;
  seen: Set<string>;
  lastPermissionKey: string | undefined;
  lastPermissionMode: string | undefined;
  lastExecutionKey: string | undefined;
  lastExecutionMode: string | undefined;
  lastCollaborationMode: string | undefined;
  lastThinkingLevel: string | undefined;
  lastFlavorKey: string | undefined;
}

export function initialCodexState(): CodexState {
  return {
    lastModel: undefined,
    currentTurnId: "turn-implicit",
    seen: new Set<string>(),
    lastPermissionKey: undefined,
    lastPermissionMode: undefined,
    lastExecutionKey: undefined,
    lastExecutionMode: undefined,
    lastCollaborationMode: undefined,
    lastThinkingLevel: undefined,
    lastFlavorKey: undefined,
  };
}

function payloadOf(record: Raw): Raw {
  return isObject(record.payload) ? record.payload : {};
}

function emittable(record: Raw): boolean {
  return timestampToIso(record.timestamp) !== undefined;
}

type SettingTrigger = "initial" | "runtime_inferred";

function modelChangeDraft(
  fromModel: string | undefined,
  toModel: string,
  trigger: SettingTrigger,
  turnId: string | undefined,
): TrailEntryDraft {
  return {
    type: "model_change",
    payload: {
      to_model: toModel,
      ...(fromModel !== undefined ? { from_model: fromModel } : {}),
      trigger,
      ...(turnId !== undefined ? { turn_id: turnId } : {}),
    },
    source: {
      agent: AGENT_NAME,
      original_type: "turn_context.model_change",
      synthesized: true,
    },
    meta: { "dev.codex.raw_type": "turn_context.model_change" },
  };
}

function modeChangeDraft(
  scope: "permission" | "execution" | "collaboration",
  fromMode: string | undefined,
  toMode: string,
  trigger: SettingTrigger,
  payload: Raw,
  originalType: string,
): TrailEntryDraft {
  return {
    type: "mode_change",
    payload: {
      scope,
      to_mode: toMode,
      ...(fromMode !== undefined ? { from_mode: fromMode } : {}),
      trigger,
      ...(typeof payload.turn_id === "string" ? { turn_id: payload.turn_id } : {}),
      data: { ...payload },
    },
    source: { agent: AGENT_NAME, original_type: originalType, synthesized: true },
    meta: { "dev.codex.raw_type": originalType },
  };
}

function thinkingLevelChangeDraft(
  fromLevel: string | undefined,
  toLevel: string,
  trigger: SettingTrigger,
  turnId: string | undefined,
): TrailEntryDraft {
  return {
    type: "thinking_level_change",
    payload: {
      to_level: toLevel,
      ...(fromLevel !== undefined ? { from_level: fromLevel } : {}),
      trigger,
      ...(turnId !== undefined ? { turn_id: turnId } : {}),
    },
    source: {
      agent: AGENT_NAME,
      original_type: "turn_context.thinking_level_change",
      synthesized: true,
    },
    meta: { "dev.codex.raw_type": "turn_context.thinking_level_change" },
  };
}

function pickPersonalityAxis(p: Raw): Raw {
  return p.personality !== undefined ? { personality: p.personality } : {};
}

// Remaining flavor axis changes (currently personality) stay vendor-specific.
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
// model_change and first-class mode/thinking changes when observed settings
// initialize or change. Header meta still snapshots the first full turn_context.
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
      if (ctx.state.lastModel === undefined) {
        drafts.push(modelChangeDraft(undefined, model, "initial", turnId));
      } else if (ctx.state.lastModel !== model) {
        drafts.push(modelChangeDraft(ctx.state.lastModel, model, "runtime_inferred", turnId));
      }
      ctx.state.lastModel = model;
    }
    const permAxis = turnContextPermissionAxis(p);
    if (Object.keys(permAxis).length > 0) {
      const permKey = stableAxisKey(permAxis);
      const nextMode = permissionModeLabel(p);
      if (nextMode !== undefined) {
        if (ctx.state.lastPermissionKey === undefined) {
          drafts.push(
            modeChangeDraft(
              "permission",
              undefined,
              nextMode,
              "initial",
              { ...permAxis, turn_id: p.turn_id },
              "turn_context.permission",
            ),
          );
        } else if (ctx.state.lastPermissionKey !== permKey) {
          drafts.push(
            modeChangeDraft(
              "permission",
              ctx.state.lastPermissionMode !== nextMode ? ctx.state.lastPermissionMode : undefined,
              nextMode,
              "runtime_inferred",
              { ...permAxis, turn_id: p.turn_id },
              "turn_context.permission",
            ),
          );
        }
      }
      ctx.state.lastPermissionKey = permKey;
      ctx.state.lastPermissionMode = nextMode;
    }
    const executionAxis = turnContextExecutionAxis(p);
    if (Object.keys(executionAxis).length > 0) {
      const executionMode = stringValue(p.sandbox_policy) ?? "execution-policy";
      const executionKey = stableAxisKey(executionAxis);
      if (ctx.state.lastExecutionKey === undefined) {
        drafts.push(
          modeChangeDraft(
            "execution",
            undefined,
            executionMode,
            "initial",
            { ...executionAxis, turn_id: p.turn_id },
            "turn_context.execution",
          ),
        );
      } else if (ctx.state.lastExecutionKey !== executionKey) {
        drafts.push(
          modeChangeDraft(
            "execution",
            ctx.state.lastExecutionMode !== executionMode ? ctx.state.lastExecutionMode : undefined,
            executionMode,
            "runtime_inferred",
            { ...executionAxis, turn_id: p.turn_id },
            "turn_context.execution",
          ),
        );
      }
      ctx.state.lastExecutionKey = executionKey;
      ctx.state.lastExecutionMode = executionMode;
    }
    const collaborationMode = stringValue(p.collaboration_mode);
    if (collaborationMode !== undefined) {
      if (ctx.state.lastCollaborationMode === undefined) {
        drafts.push(
          modeChangeDraft(
            "collaboration",
            undefined,
            collaborationMode,
            "initial",
            { collaboration_mode: p.collaboration_mode, turn_id: p.turn_id },
            "turn_context.collaboration",
          ),
        );
      } else if (ctx.state.lastCollaborationMode !== collaborationMode) {
        drafts.push(
          modeChangeDraft(
            "collaboration",
            ctx.state.lastCollaborationMode,
            collaborationMode,
            "runtime_inferred",
            { collaboration_mode: p.collaboration_mode, turn_id: p.turn_id },
            "turn_context.collaboration",
          ),
        );
      }
      ctx.state.lastCollaborationMode = collaborationMode;
    }
    const effort = stringValue(p.effort);
    if (effort !== undefined) {
      if (ctx.state.lastThinkingLevel === undefined) {
        drafts.push(thinkingLevelChangeDraft(undefined, effort, "initial", turnId));
      } else if (ctx.state.lastThinkingLevel !== effort) {
        drafts.push(
          thinkingLevelChangeDraft(ctx.state.lastThinkingLevel, effort, "runtime_inferred", turnId),
        );
      }
      ctx.state.lastThinkingLevel = effort;
    }
    const flavorAxis = pickPersonalityAxis(p);
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
