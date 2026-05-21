import type { Entry } from "@agent-trail/types";
import { baseEntry, blockId, entryId, stampRawType } from "./entry-metadata.ts";
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

function mapUserEnvelope(envelope: PiEnvelope, schemaVersion?: string): Entry[] {
  const content = envelope.message?.content;
  const text = typeof content === "string" ? content : textFromContent(content);
  const base = baseEntry(envelope, entryId(envelope), "message", undefined, undefined, {
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

function synthesizeInterrupt(envelope: PiEnvelope, schemaVersion?: string): Entry | undefined {
  const base = baseEntry(
    envelope,
    entryId(envelope, "aborted"),
    "assistant",
    undefined,
    undefined,
    { synthesized: true, schemaVersion },
  );
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
  envelope: PiEnvelope,
  toolCallIdToEventId: Map<string, string>,
  toolCallIdToToolKind: Map<string, string>,
  schemaVersion?: string,
): Entry[] {
  const aborted = envelope.message?.stopReason === "aborted";
  const content = envelope.message?.content;
  if (typeof content === "string") {
    const base = baseEntry(envelope, entryId(envelope), "message", undefined, undefined, {
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
          },
        } as Entry,
        "assistant_string_content",
      ),
    ];
    if (aborted) {
      const interrupt = synthesizeInterrupt(envelope, schemaVersion);
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
  const emittedBlocks: Entry[] = emittable.flatMap(({ block, originalIndex }, emittedIndex) => {
    const id = blockId(envelope, block.type ?? "block", emittedIndex, emittable.length);
    const base = baseEntry(envelope, id, block.type, block, originalIndex, { schemaVersion });
    if (base === undefined) return [];
    const model = envelope.message?.model;
    if (block.type === "text" && typeof block.text === "string") {
      const stopReason = envelope.message?.stopReason;
      return [
        stampRawType(
          {
            ...base,
            type: "agent_message",
            payload: {
              text: block.text,
              ...(typeof model === "string" ? { model } : {}),
              ...(typeof stopReason === "string" ? { stop_reason: stopReason } : {}),
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
    const interrupt = synthesizeInterrupt(envelope, schemaVersion);
    if (interrupt !== undefined) emittedBlocks.push(interrupt);
  }
  return emittedBlocks;
}

function mapToolResultEnvelope(
  envelope: PiEnvelope,
  toolCallIdToEventId: Map<string, string>,
  toolCallIdToToolKind: Map<string, string>,
  schemaVersion?: string,
): Entry[] {
  const base = baseEntry(envelope, entryId(envelope), "message", undefined, undefined, {
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
  envelope: PiEnvelope,
  prevModel: string | undefined,
  schemaVersion?: string,
): Entry[] {
  const base = baseEntry(envelope, entryId(envelope), "model_change", undefined, undefined, {
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
        ...(provider !== undefined ? { metadata: { "dev.pi.model_change": { provider } } } : {}),
      } as Entry,
      "model_change_envelope",
    ),
  ];
}

function mapCompactionEnvelope(envelope: PiEnvelope, schemaVersion?: string): Entry[] {
  const base = baseEntry(envelope, entryId(envelope), "compaction", undefined, undefined, {
    schemaVersion,
  });
  if (base === undefined) return [];
  const summary = stringValue(envelope.summary) ?? "";
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
        ...(Object.keys(piMeta).length > 0 ? { metadata: { "dev.pi.compaction": piMeta } } : {}),
      } as Entry,
      "compaction_envelope",
    ),
  ];
}

function mapBranchSummaryEnvelope(envelope: PiEnvelope, schemaVersion?: string): Entry[] {
  const base = baseEntry(envelope, entryId(envelope), "branch_summary", undefined, undefined, {
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
        ...(details !== undefined ? { metadata: { "dev.pi.branch_details": details } } : {}),
      } as Entry,
      "branch_summary_envelope",
    ),
  ];
}

export function buildEntries(
  envelope: PiEnvelope,
  toolCallIdToEventId: Map<string, string>,
  toolCallIdToToolKind: Map<string, string>,
  schemaVersion?: string,
  prevModel?: string,
): Entry[] {
  if (envelope.id === undefined || envelope.timestamp === undefined) return [];
  if (envelope.type === "branch_summary") {
    return mapBranchSummaryEnvelope(envelope, schemaVersion);
  }
  if (envelope.type === "compaction") {
    return mapCompactionEnvelope(envelope, schemaVersion);
  }
  if (envelope.type === "model_change") {
    return mapModelChangeEnvelope(envelope, prevModel, schemaVersion);
  }
  if (envelope.type !== "message") return [];
  const role = envelope.message?.role;
  if (role === "user") return mapUserEnvelope(envelope, schemaVersion);
  if (role === "assistant") {
    return mapAssistantEnvelope(envelope, toolCallIdToEventId, toolCallIdToToolKind, schemaVersion);
  }
  if (role === "toolResult") {
    return mapToolResultEnvelope(
      envelope,
      toolCallIdToEventId,
      toolCallIdToToolKind,
      schemaVersion,
    );
  }
  return [];
}
