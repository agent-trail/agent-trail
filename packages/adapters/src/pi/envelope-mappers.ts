import type { Entry } from "@agent-trail/types";
import { baseEntry, blockId, entryId } from "./entry-metadata.ts";
import {
  asBlocks,
  isObject,
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
  return [{ ...base, type: "user_message", payload: { text } } as Entry];
}

function mapAssistantEnvelope(
  envelope: PiEnvelope,
  toolCallIdToEventId: Map<string, string>,
  toolCallIdToToolKind: Map<string, string>,
  schemaVersion?: string,
): Entry[] {
  const content = envelope.message?.content;
  if (typeof content === "string") {
    const base = baseEntry(envelope, entryId(envelope), "message", undefined, undefined, {
      schemaVersion,
    });
    if (base === undefined) return [];
    const model = envelope.message?.model;
    const stopReason = envelope.message?.stopReason;
    return [
      {
        ...base,
        type: "agent_message",
        payload: {
          text: content,
          ...(typeof model === "string" ? { model } : {}),
          ...(typeof stopReason === "string" ? { stop_reason: stopReason } : {}),
        },
      } as Entry,
    ];
  }
  const blocks = asBlocks(content);
  // Capture each emittable block's original index in message.content so source.raw.block_index
  // stays faithful when the envelope mixes other block types (thinking, custom, etc.).
  const emittable: Array<{ block: PiBlock; originalIndex: number }> = [];
  blocks.forEach((block, originalIndex) => {
    if (block.type === "text" || block.type === "toolCall") {
      emittable.push({ block, originalIndex });
    }
  });
  return emittable.flatMap(({ block, originalIndex }, emittedIndex) => {
    const id = blockId(envelope, block.type ?? "block", emittedIndex, emittable.length);
    const base = baseEntry(envelope, id, block.type, block, originalIndex, { schemaVersion });
    if (base === undefined) return [];
    const model = envelope.message?.model;
    if (block.type === "text" && typeof block.text === "string") {
      const stopReason = envelope.message?.stopReason;
      return [
        {
          ...base,
          type: "agent_message",
          payload: {
            text: block.text,
            ...(typeof model === "string" ? { model } : {}),
            ...(typeof stopReason === "string" ? { stop_reason: stopReason } : {}),
          },
        } as Entry,
      ];
    }
    if (block.type === "toolCall") {
      const name = stringValue(block.name);
      const callId = stringValue(block.id);
      const mapped = toolKindAndArgs(name, block.arguments);
      if (callId !== undefined) {
        toolCallIdToEventId.set(callId, id);
        toolCallIdToToolKind.set(callId, mapped.tool);
      }
      return [
        {
          ...base,
          type: "tool_call",
          payload: mapped,
          semantic: {
            ...(callId !== undefined ? { call_id: callId } : {}),
            tool_kind: mapped.tool,
          },
        } as Entry,
      ];
    }
    return [];
  });
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
  const callId = stringValue(envelope.message?.toolCallId);
  const forId = callId !== undefined ? toolCallIdToEventId.get(callId) : undefined;
  const toolKind = callId !== undefined ? toolCallIdToToolKind.get(callId) : undefined;
  const ok = envelope.message?.isError !== true;
  const output = textFromContent(envelope.message?.content);
  return [
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
    {
      ...base,
      type: "branch_summary",
      payload: {
        abandoned_branch_id: fromId,
        summary,
      },
      ...(details !== undefined ? { metadata: { "dev.pi-mono.branch_details": details } } : {}),
    } as Entry,
  ];
}

export function buildEntries(
  envelope: PiEnvelope,
  toolCallIdToEventId: Map<string, string>,
  toolCallIdToToolKind: Map<string, string>,
  schemaVersion?: string,
): Entry[] {
  if (envelope.id === undefined || envelope.timestamp === undefined) return [];
  if (envelope.type === "branch_summary") {
    return mapBranchSummaryEnvelope(envelope, schemaVersion);
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
