import type { Entry } from "@agent-trail/types";
import { baseEntry, blockId, entryId } from "./entry-metadata.ts";
import {
  asBlocks,
  type CcEnvelope,
  isContinuationPreamble,
  jsonObjectValue,
  jsonString,
  stringValue,
  textFromToolResultContent,
} from "./source.ts";
import { toolKindAndArgs } from "./tools.ts";

function systemEventText(envelope: CcEnvelope): string {
  if (envelope.type === "system") {
    const subtype = stringValue(envelope.subtype) ?? "system";
    const content = stringValue(envelope.content);
    return content?.trim() ? content : `System event: ${subtype}`;
  }
  if (envelope.type === "progress") {
    const data = jsonObjectValue(envelope.data);
    const dataType = stringValue(data?.type) ?? "progress";
    if (dataType === "hook_progress") {
      const hookEvent = stringValue(data?.hookEvent) ?? "hook";
      const hookName = stringValue(data?.hookName);
      return hookName?.trim()
        ? `Hook progress: ${hookEvent} (${hookName})`
        : `Hook progress: ${hookEvent}`;
    }
    const message = stringValue(data?.message);
    return message?.trim() ? `Progress: ${message.trim()}` : `Progress: ${dataType}`;
  }
  if (envelope.type === "queue-operation") {
    const operation = stringValue(envelope.operation) ?? "unknown";
    const content = stringValue(envelope.content);
    return operation === "enqueue" && content?.trim()
      ? `Queued input: ${content.trim()}`
      : `Queue operation: ${operation}`;
  }
  return "System event";
}

function systemEventKind(envelope: CcEnvelope): string {
  if (envelope.type === "queue-operation") return "queue_operation";
  if (envelope.type === "progress") {
    const data = jsonObjectValue(envelope.data);
    return stringValue(data?.type) === "hook_progress" ? "hook_progress" : "progress";
  }
  return "system";
}

function mapSystemEventEnvelope(envelope: CcEnvelope): Entry[] {
  const base = baseEntry(envelope, entryId(envelope), envelope.type);
  if (base === undefined) return [];
  const data = envelope.type === "progress" ? jsonObjectValue(envelope.data) : undefined;
  return [
    {
      ...base,
      type: "system_event",
      payload: {
        kind: systemEventKind(envelope),
        text: systemEventText(envelope),
        ...(data !== undefined ? { data } : {}),
      },
    } as Entry,
  ];
}

function mapSummaryEnvelope(envelope: CcEnvelope): Entry[] {
  const text =
    stringValue(envelope.summary) ??
    stringValue(envelope.message?.content) ??
    jsonString(envelope.message?.content);
  const base = baseEntry(envelope, entryId(envelope), "summary");
  if (base === undefined) return [];
  if (envelope.isCompactSummary === true) {
    return [
      {
        ...base,
        type: "context_compact",
        payload: { summary: text, trigger: "auto" },
      } as Entry,
    ];
  }
  return [
    {
      ...base,
      type: "session_summary",
      payload: { scope: "session", text },
      semantic: {
        ...(typeof envelope.leafUuid === "string" ? { group_id: envelope.leafUuid } : {}),
      },
    } as Entry,
  ];
}

function mapUserEnvelope(
  envelope: CcEnvelope,
  toolUseIdToEventId: Map<string, string>,
  toolUseIdToToolKind: Map<string, string>,
): Entry[] {
  const content = envelope.message?.content;
  if (typeof content === "string") {
    const base = baseEntry(envelope, entryId(envelope), "user");
    if (base === undefined) return [];
    if (isContinuationPreamble(content)) {
      return [
        {
          ...base,
          type: "system_event",
          payload: { kind: "system", text: content },
        } as Entry,
      ];
    }
    return [{ ...base, type: "user_message", payload: { text: content } } as Entry];
  }

  const blocks = asBlocks(content);
  const emittedBlocks = blocks.filter(
    (block) => block.type === "text" || block.type === "tool_result",
  );
  return emittedBlocks.flatMap((block, emittedIndex) => {
    const id = blockId(envelope, block.type ?? "block", emittedIndex, emittedBlocks.length);
    const base = baseEntry(envelope, id, block.type, block, emittedIndex);
    if (base === undefined) return [];
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text;
      return [
        isContinuationPreamble(text)
          ? ({
              ...base,
              type: "system_event",
              payload: { kind: "system", text },
            } as Entry)
          : ({ ...base, type: "user_message", payload: { text } } as Entry),
      ];
    }
    if (block.type === "tool_result") {
      const callId = stringValue(block.tool_use_id);
      const forId = callId !== undefined ? toolUseIdToEventId.get(callId) : undefined;
      const toolKind = callId !== undefined ? toolUseIdToToolKind.get(callId) : undefined;
      const ok = block.is_error !== true;
      const output = textFromToolResultContent(block.content);
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
    return [];
  });
}

function mapAssistantEnvelope(
  envelope: CcEnvelope,
  toolUseIdToEventId: Map<string, string>,
  toolUseIdToToolKind: Map<string, string>,
): Entry[] {
  const blocks = asBlocks(envelope.message?.content);
  const emittedBlocks = blocks.filter(
    (block) =>
      block.type === "text" ||
      block.type === "thinking" ||
      block.type === "redacted_thinking" ||
      block.type === "tool_use",
  );
  return emittedBlocks.flatMap((block, emittedIndex) => {
    const id = blockId(envelope, block.type ?? "block", emittedIndex, emittedBlocks.length);
    const base = baseEntry(envelope, id, block.type, block, emittedIndex);
    if (base === undefined) return [];
    const model = envelope.message?.model;
    if (block.type === "text" && typeof block.text === "string") {
      return [
        {
          ...base,
          type: "agent_message",
          payload: {
            text: block.text,
            ...(typeof model === "string" ? { model } : {}),
            ...(typeof envelope.message?.stop_reason === "string"
              ? { stop_reason: envelope.message.stop_reason }
              : {}),
          },
        } as Entry,
      ];
    }
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      const text =
        stringValue(block.thinking) ??
        stringValue(block.data) ??
        (block.type === "redacted_thinking" ? "[redacted thinking]" : "");
      if (text.length === 0) return [];
      return [
        {
          ...base,
          type: "agent_thinking",
          payload: {
            text,
            ...(typeof model === "string" ? { model } : {}),
          },
        } as Entry,
      ];
    }
    if (block.type === "tool_use") {
      const name = stringValue(block.name);
      const callId = stringValue(block.id);
      const mapped = toolKindAndArgs(name, block.input);
      if (callId !== undefined) {
        toolUseIdToEventId.set(callId, id);
        toolUseIdToToolKind.set(callId, mapped.tool);
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

export function buildEntries(
  envelope: CcEnvelope,
  toolUseIdToEventId: Map<string, string>,
  toolUseIdToToolKind: Map<string, string>,
): Entry[] {
  if (envelope.uuid === undefined || envelope.timestamp === undefined) return [];

  if (
    envelope.type === "system" ||
    envelope.type === "progress" ||
    envelope.type === "queue-operation"
  ) {
    return mapSystemEventEnvelope(envelope);
  }
  if (envelope.type === "summary") return mapSummaryEnvelope(envelope);
  if (envelope.type === "user") {
    return mapUserEnvelope(envelope, toolUseIdToEventId, toolUseIdToToolKind);
  }
  if (envelope.type === "assistant") {
    return mapAssistantEnvelope(envelope, toolUseIdToEventId, toolUseIdToToolKind);
  }
  return [];
}
