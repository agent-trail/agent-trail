import type { Entry } from "@agent-trail/types";
import { pickBlockId } from "../entries.ts";
import { mapAgentMessageUsage } from "../usage.ts";
import { baseEntry, type PiEntryIdCtx, stampRawType } from "./entry-metadata.ts";
import {
  asBlocks,
  idValue,
  isObject,
  numericValue,
  type PiBlock,
  type PiEnvelope,
  stringValue,
  textFromContent,
} from "./source.ts";
import { toolKindAndArgs } from "./tools.ts";

function mapUserEnvelope(ctx: PiEntryIdCtx, envelope: PiEnvelope, schemaVersion?: string): Entry[] {
  const content = envelope.message?.content;
  const text = typeof content === "string" ? content : textFromContent(content);
  const base = baseEntry(envelope, ctx.entryId(envelope), "message", undefined, undefined, {
    schemaVersion,
  });
  if (base === undefined) return [];
  return [
    stampRawType(
      { ...base, type: "user_message", payload: { text } } as Entry,
      "user_message_envelope",
    ),
  ];
}

function synthesizeInterrupt(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  schemaVersion?: string,
): Entry | undefined {
  // Deterministic synthesized id seeded with (session_uid, source_id,
  // "aborted") so re-parses are idempotent per spec §8.5. `buildEntries`
  // already short-circuits when `envelope.id` is undefined, so the missing-id
  // case is unreachable here — guard explicitly to fail loud if that
  // invariant ever breaks (a silent fallback would alias multiple aborted
  // envelopes onto the same synthesized id).
  if (typeof envelope.id !== "string") {
    throw new Error("Pi aborted envelope reached synthesizeInterrupt without source id");
  }
  const synthId = ctx.deriveSynthesizedId([envelope.id, "aborted"]);
  const base = baseEntry(envelope, synthId, "assistant", undefined, undefined, {
    synthesized: true,
    schemaVersion,
  });
  if (base === undefined) return undefined;
  return stampRawType(
    {
      ...base,
      type: "user_interrupt",
      payload: { reason: "stop_reason_aborted" },
    } as Entry,
    "aborted_assistant_synthetic",
  );
}

function mapAssistantEnvelope(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  toolCallIdToEventId: Map<string, string>,
  toolCallIdToToolKind: Map<string, string>,
  schemaVersion?: string,
): Entry[] {
  const aborted = envelope.message?.stopReason === "aborted";
  const content = envelope.message?.content;
  const envelopeUsage = mapAgentMessageUsage(envelope.message?.usage);
  if (typeof content === "string") {
    const base = baseEntry(envelope, ctx.entryId(envelope), "message", undefined, undefined, {
      schemaVersion,
    });
    if (base === undefined) return [];
    const model = envelope.message?.model;
    const stopReason = envelope.message?.stopReason;
    const out: Entry[] = [
      stampRawType(
        {
          ...base,
          type: "agent_message",
          payload: {
            text: content,
            ...(typeof model === "string" ? { model } : {}),
            ...(typeof stopReason === "string" ? { stop_reason: stopReason } : {}),
            ...(envelopeUsage !== undefined ? { usage: envelopeUsage } : {}),
          },
        } as Entry,
        "assistant_string_content",
      ),
    ];
    if (aborted) {
      const interrupt = synthesizeInterrupt(ctx, envelope, schemaVersion);
      if (interrupt !== undefined) out.push(interrupt);
    }
    return out;
  }
  const blocks = asBlocks(content);
  // Capture each emittable block's original index in message.content so source.raw.block_index
  // stays faithful when the envelope mixes other block types (custom, etc.).
  const emittable: Array<{ block: PiBlock; originalIndex: number }> = [];
  blocks.forEach((block, originalIndex) => {
    if (block.type === "text" || block.type === "toolCall" || block.type === "thinking") {
      emittable.push({ block, originalIndex });
    }
  });
  const stableId = ctx.entryId(envelope);
  const sourceId = typeof envelope.id === "string" ? envelope.id : stableId;
  const emittable_ids = emittable.map((_, emittedIndex) =>
    pickBlockId(
      stableId,
      emittable.length,
      (idx) => ctx.deriveBlockId(sourceId, idx),
      emittedIndex,
    ),
  );
  const firstEntryId = emittable_ids[0];
  let usageEmitted = false;
  const emittedBlocks: Entry[] = emittable.flatMap(({ block, originalIndex }, emittedIndex) => {
    const id = emittable_ids[emittedIndex] ?? "";
    const envelopeRef = emittedIndex > 0 ? firstEntryId : undefined;
    const base = baseEntry(envelope, id, block.type, block, originalIndex, {
      schemaVersion,
      envelopeRef,
    });
    if (base === undefined) return [];
    const model = envelope.message?.model;
    if (block.type === "text" && typeof block.text === "string") {
      const stopReason = envelope.message?.stopReason;
      const usage = !usageEmitted ? envelopeUsage : undefined;
      if (usage !== undefined) usageEmitted = true;
      return [
        stampRawType(
          {
            ...base,
            type: "agent_message",
            payload: {
              text: block.text,
              ...(typeof model === "string" ? { model } : {}),
              ...(typeof stopReason === "string" ? { stop_reason: stopReason } : {}),
              ...(usage !== undefined ? { usage } : {}),
            },
          } as Entry,
          "assistant_text_block",
        ),
      ];
    }
    if (block.type === "thinking") {
      const rawThinking = typeof block.thinking === "string" ? block.thinking : "";
      const redacted = block.redacted === true && rawThinking.length === 0;
      const thinkingText = redacted ? "[redacted thinking]" : rawThinking;
      return [
        stampRawType(
          {
            ...base,
            type: "agent_thinking",
            payload: {
              text: thinkingText,
              ...(typeof model === "string" ? { model } : {}),
            },
          } as Entry,
          redacted ? "assistant_redacted_thinking_block" : "assistant_thinking_block",
        ),
      ];
    }
    if (block.type === "toolCall") {
      const name = stringValue(block.name);
      const callId = idValue(block.id);
      const mapped = toolKindAndArgs(name, block.arguments);
      if (callId !== undefined) {
        toolCallIdToEventId.set(callId, id);
        toolCallIdToToolKind.set(callId, mapped.tool);
      }
      return [
        stampRawType(
          {
            ...base,
            type: "tool_call",
            payload: mapped,
            semantic: {
              ...(callId !== undefined ? { call_id: callId } : {}),
              tool_kind: mapped.tool,
            },
          } as Entry,
          "assistant_toolcall_block",
        ),
      ];
    }
    return [];
  });
  if (aborted) {
    const interrupt = synthesizeInterrupt(ctx, envelope, schemaVersion);
    if (interrupt !== undefined) emittedBlocks.push(interrupt);
  }
  return emittedBlocks;
}

function mapToolResultEnvelope(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  toolCallIdToEventId: Map<string, string>,
  toolCallIdToToolKind: Map<string, string>,
  schemaVersion?: string,
): Entry[] {
  const base = baseEntry(envelope, ctx.entryId(envelope), "message", undefined, undefined, {
    schemaVersion,
  });
  if (base === undefined) return [];
  const callId = idValue(envelope.message?.toolCallId);
  const forId = callId !== undefined ? toolCallIdToEventId.get(callId) : undefined;
  const toolKind = callId !== undefined ? toolCallIdToToolKind.get(callId) : undefined;
  const ok = envelope.message?.isError !== true;
  const output = textFromContent(envelope.message?.content);
  return [
    stampRawType(
      {
        ...base,
        type: "tool_result",
        payload: {
          ...(forId !== undefined ? { for_id: forId } : {}),
          ok,
          ...(output.length > 0 ? { output } : {}),
          ...(!ok && output.length > 0 ? { error: output } : {}),
        },
        ...(callId !== undefined || toolKind !== undefined
          ? {
              semantic: {
                ...(callId !== undefined ? { call_id: callId } : {}),
                ...(toolKind !== undefined ? { tool_kind: toolKind } : {}),
              },
            }
          : {}),
      } as Entry,
      "tool_result_envelope",
    ),
  ];
}

function mapModelChangeEnvelope(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  prevModel: string | undefined,
  schemaVersion?: string,
): Entry[] {
  const base = baseEntry(envelope, ctx.entryId(envelope), "model_change", undefined, undefined, {
    schemaVersion,
  });
  if (base === undefined) return [];
  const toModel = stringValue(envelope.modelId);
  if (toModel === undefined) return [];
  const provider = stringValue(envelope.provider);
  return [
    stampRawType(
      {
        ...base,
        type: "model_change",
        payload: {
          ...(prevModel !== undefined ? { from_model: prevModel } : {}),
          to_model: toModel,
        },
        ...(provider !== undefined ? { meta: { "dev.pi.model_change": { provider } } } : {}),
      } as Entry,
      "model_change_envelope",
    ),
  ];
}

function mapCompactionEnvelope(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  schemaVersion?: string,
): Entry[] {
  const base = baseEntry(envelope, ctx.entryId(envelope), "compaction", undefined, undefined, {
    schemaVersion,
  });
  if (base === undefined) return [];
  // Pi-mono `CompactionEntry.summary` is typed `string`. A missing or non-string `summary` means
  // partial/corrupt source data — drop the entry rather than fabricate an empty payload that
  // downstream consumers cannot distinguish from a real empty summary.
  const summary = stringValue(envelope.summary);
  if (summary === undefined) return [];
  const tokensBefore = numericValue(envelope.tokensBefore);
  const firstKeptEntryId = envelope.firstKeptEntryId;
  const fromHook = envelope.fromHook;
  const details = envelope.details;
  const piMeta: Record<string, unknown> = {};
  if (firstKeptEntryId !== undefined) piMeta.firstKeptEntryId = firstKeptEntryId;
  if (details !== undefined) piMeta.details = details;
  if (fromHook !== undefined) piMeta.fromHook = fromHook;
  return [
    stampRawType(
      {
        ...base,
        type: "context_compact",
        payload: {
          summary,
          ...(tokensBefore !== undefined ? { tokens_before: tokensBefore } : {}),
          trigger: "auto",
        },
        ...(Object.keys(piMeta).length > 0 ? { meta: { "dev.pi.compaction": piMeta } } : {}),
      } as Entry,
      "compaction_envelope",
    ),
  ];
}

// Pi `thinking_level_change` carries a single field (`thinkingLevel`: low|medium|high).
// No reserved kind matches — `model_change` covers model id only, not thinking level.
// Surface as a vendor-namespaced system_event so consumers see the boundary.
function mapThinkingLevelChangeEnvelope(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  schemaVersion?: string,
): Entry[] {
  const base = baseEntry(
    envelope,
    ctx.entryId(envelope),
    "thinking_level_change",
    undefined,
    undefined,
    { schemaVersion },
  );
  if (base === undefined) return [];
  const level = stringValue(envelope.thinkingLevel);
  return [
    stampRawType(
      {
        ...base,
        type: "system_event",
        payload: {
          kind: "x-pi/thinking_level_change",
          text: level !== undefined ? `Thinking level set to ${level}` : "Thinking level change",
          ...(level !== undefined ? { data: { thinking_level: level } } : {}),
        },
      } as Entry,
      "thinking_level_change_envelope",
    ),
  ];
}

// Pi `session_info` carries an auto-generated session name (pi-mono session-namer hook).
// No portable equivalent yet — surface as `x-pi/session_info` so the rename is preserved
// without claiming cross-agent semantics.
function mapSessionInfoEnvelope(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  schemaVersion?: string,
): Entry[] {
  const base = baseEntry(envelope, ctx.entryId(envelope), "session_info", undefined, undefined, {
    schemaVersion,
  });
  if (base === undefined) return [];
  const name = stringValue(envelope.name);
  return [
    stampRawType(
      {
        ...base,
        type: "system_event",
        payload: {
          kind: "x-pi/session_info",
          text: name !== undefined ? `Session info: ${name}` : "Session info",
          ...(name !== undefined ? { data: { name } } : {}),
        },
      } as Entry,
      "session_info_envelope",
    ),
  ];
}

// Pi `custom` / `custom_message` are the plugin extension surface. The adapter does NOT
// enumerate every `customType` — plugins author their own. Collapse both into one
// vendor kind per envelope-type and preserve the source `customType` under `data` so
// consumers can disambiguate without us pretending to support every plugin shape.
function mapCustomEnvelope(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  schemaVersion?: string,
): Entry[] {
  const isMessage = envelope.type === "custom_message";
  const base = baseEntry(
    envelope,
    ctx.entryId(envelope),
    isMessage ? "custom_message" : "custom",
    undefined,
    undefined,
    { schemaVersion },
  );
  if (base === undefined) return [];
  const customType = stringValue(envelope.customType);
  const data: Record<string, unknown> = {};
  if (customType !== undefined) data.custom_type = customType;
  const inner = isObject(envelope.data) ? envelope.data : undefined;
  if (inner !== undefined) data.custom_data = inner;
  const content = stringValue(envelope.content);
  // Plugin-extension surface: preserve `content` verbatim so leading/trailing
  // whitespace authored by the plugin is not mutated. Only synthesize a fallback
  // when content is missing or blank.
  const hasContent = content !== undefined && content.trim().length > 0;
  const text = hasContent
    ? (content as string)
    : customType !== undefined
      ? `${isMessage ? "Custom message" : "Custom"}: ${customType}`
      : isMessage
        ? "Custom message"
        : "Custom event";
  return [
    stampRawType(
      {
        ...base,
        type: "system_event",
        payload: {
          kind: isMessage ? "x-pi/custom_message" : "x-pi/custom",
          text,
          ...(Object.keys(data).length > 0 ? { data } : {}),
        },
      } as Entry,
      isMessage ? "custom_message_envelope" : "custom_envelope",
    ),
  ];
}

function mapBranchSummaryEnvelope(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  schemaVersion?: string,
): Entry[] {
  const base = baseEntry(envelope, ctx.entryId(envelope), "branch_summary", undefined, undefined, {
    schemaVersion,
  });
  if (base === undefined) return [];
  const summary = stringValue(envelope.summary);
  const fromId = stringValue(envelope.fromId);
  if (summary === undefined || fromId === undefined) return [];
  const details = isObject(envelope.details) ? envelope.details : undefined;
  return [
    stampRawType(
      {
        ...base,
        type: "branch_summary",
        payload: {
          abandoned_branch_id: fromId,
          summary,
        },
        ...(details !== undefined ? { meta: { "dev.pi.branch_details": details } } : {}),
      } as Entry,
      "branch_summary_envelope",
    ),
  ];
}

export function buildEntries(
  ctx: PiEntryIdCtx,
  envelope: PiEnvelope,
  toolCallIdToEventId: Map<string, string>,
  toolCallIdToToolKind: Map<string, string>,
  schemaVersion?: string,
  prevModel?: string,
): Entry[] {
  if (envelope.id === undefined || envelope.timestamp === undefined) return [];
  if (envelope.type === "branch_summary") {
    return mapBranchSummaryEnvelope(ctx, envelope, schemaVersion);
  }
  if (envelope.type === "compaction") {
    return mapCompactionEnvelope(ctx, envelope, schemaVersion);
  }
  if (envelope.type === "model_change") {
    return mapModelChangeEnvelope(ctx, envelope, prevModel, schemaVersion);
  }
  if (envelope.type === "thinking_level_change") {
    return mapThinkingLevelChangeEnvelope(ctx, envelope, schemaVersion);
  }
  if (envelope.type === "session_info") {
    return mapSessionInfoEnvelope(ctx, envelope, schemaVersion);
  }
  if (envelope.type === "custom" || envelope.type === "custom_message") {
    return mapCustomEnvelope(ctx, envelope, schemaVersion);
  }
  if (envelope.type !== "message") return [];
  const role = envelope.message?.role;
  if (role === "user") return mapUserEnvelope(ctx, envelope, schemaVersion);
  if (role === "assistant") {
    return mapAssistantEnvelope(
      ctx,
      envelope,
      toolCallIdToEventId,
      toolCallIdToToolKind,
      schemaVersion,
    );
  }
  if (role === "toolResult") {
    return mapToolResultEnvelope(
      ctx,
      envelope,
      toolCallIdToEventId,
      toolCallIdToToolKind,
      schemaVersion,
    );
  }
  return [];
}
