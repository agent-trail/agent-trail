import type { Entry } from "@agent-trail/types";
import { pickBlockId } from "../entries.ts";
import { mapAgentMessageUsage } from "../usage.ts";
import { baseEntry, entryId } from "./entry-metadata.ts";
import {
  asBlocks,
  type CcEnvelope,
  isContinuationPreamble,
  isInterruptMarker,
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
  if (envelope.type === "pr-link") {
    const num = envelope.prNumber;
    const url = stringValue(envelope.prUrl);
    if (typeof num === "number" && url !== undefined) return `PR #${num}: ${url}`;
    if (url !== undefined) return url;
    return "PR link";
  }
  return "System event";
}

// Maps Claude Code hook lifecycle events to reserved system_event kinds (spec §9.3).
// Unrecognized hookEvent values fall back to `hook_fired` so timelines surface them.
function hookEventToKind(hookEvent: string | undefined): string {
  switch (hookEvent) {
    case "SessionStart":
      return "session_start";
    case "SessionEnd":
      return "session_end";
    case "Stop":
      return "turn_end";
    case "SubagentStop":
      return "subagent_end";
    case "PreToolUse":
      return "pre_tool_use";
    case "PostToolUse":
      return "post_tool_use";
    case "Notification":
      return "permission_request";
    default:
      return "hook_fired";
  }
}

const SYSTEM_SUBTYPE_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

// Maps Claude Code `system` envelope subtypes to reserved or vendor-namespaced kinds.
// stop_hook_summary marks the turn boundary; turn_duration is duration-only metadata
// retained as a vendor extension. compact_boundary is preserved under x-claudecode
// because the canonical context_compact entry is produced by the summary envelope.
function systemSubtypeToKind(subtype: string | undefined): string {
  switch (subtype) {
    case "stop_hook_summary":
      return "turn_end";
    case "turn_duration":
      return "x-claudecode/turn_duration";
    case "compact_boundary":
      return "x-claudecode/compact_boundary";
    case "api_error":
      return "x-claudecode/api_error";
    case "away_summary":
      return "x-claudecode/away_summary";
    case "local_command":
      return "x-claudecode/local_command";
    case "bridge_status":
      return "x-claudecode/bridge_status";
    default:
      return subtype !== undefined && SYSTEM_SUBTYPE_PATTERN.test(subtype)
        ? `x-claudecode/${subtype}`
        : "x-claudecode/system";
  }
}

function systemEventKind(envelope: CcEnvelope): string {
  if (envelope.type === "queue-operation") return "queue_operation";
  if (envelope.type === "pr-link") return "x-claudecode/pr_link";
  if (envelope.type === "progress") {
    const data = jsonObjectValue(envelope.data);
    if (stringValue(data?.type) === "hook_progress") {
      return hookEventToKind(stringValue(data?.hookEvent));
    }
    return "x-claudecode/progress";
  }
  return systemSubtypeToKind(stringValue(envelope.subtype));
}

function systemEventData(envelope: CcEnvelope): Record<string, unknown> | undefined {
  if (envelope.type === "progress") return jsonObjectValue(envelope.data);
  if (envelope.type === "pr-link") {
    const out: Record<string, unknown> = {};
    if (typeof envelope.prNumber === "number") out.pr_number = envelope.prNumber;
    const url = stringValue(envelope.prUrl);
    if (url !== undefined) out.pr_url = url;
    const repo = stringValue(envelope.prRepository);
    if (repo !== undefined) out.pr_repository = repo;
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

function mapSystemEventEnvelope(envelope: CcEnvelope): Entry[] {
  // Some Claude Code envelopes (queue-operation, pr-link) lack a `uuid` field
  // but carry a usable timestamp. Synthesize a deterministic-shaped id so they
  // survive validation and stamp `source.synthesized` for traceability.
  const synthesized = typeof envelope.uuid !== "string";
  const id = synthesized ? crypto.randomUUID() : entryId(envelope);
  const base = baseEntry(
    envelope,
    id,
    envelope.type,
    undefined,
    undefined,
    synthesized ? { synthesized: true } : undefined,
  );
  if (base === undefined) return [];
  const data = systemEventData(envelope);
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

// Claude Code's `permission-mode` envelope reports a mode change
// (default / acceptEdits / plan / bypassPermissions). It lacks `uuid` and
// `timestamp`, so the adapter synthesizes both: a fresh UUID for the entry id,
// and the most recent prior envelope's timestamp for ordering. The new mode
// goes under `data.to`; the prior mode (when tracked) under `data.from`.
export function mapPermissionModeEnvelope(
  envelope: CcEnvelope,
  inheritedTimestamp: string | undefined,
  prevPermissionMode: string | undefined,
): Entry[] {
  const mode = stringValue(envelope.permissionMode);
  if (mode === undefined) return [];
  const ts = stringValue(envelope.timestamp) ?? inheritedTimestamp;
  if (ts === undefined) return [];
  const enriched: CcEnvelope = { ...envelope, timestamp: ts };
  const base = baseEntry(enriched, crypto.randomUUID(), envelope.type, undefined, undefined, {
    synthesized: true,
  });
  if (base === undefined) return [];
  const data: Record<string, unknown> = { to: mode };
  if (prevPermissionMode !== undefined && prevPermissionMode !== mode) {
    data.from = prevPermissionMode;
  }
  const text =
    prevPermissionMode !== undefined && prevPermissionMode !== mode
      ? `Permission mode changed: ${prevPermissionMode} → ${mode}`
      : `Permission mode: ${mode}`;
  return [
    {
      ...base,
      type: "system_event",
      payload: {
        kind: "permission_mode_change",
        text,
        data,
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
    const interrupt = isInterruptMarker(content);
    if (interrupt !== undefined) {
      return [
        {
          ...base,
          type: "user_interrupt",
          payload: { reason: interrupt.reason },
        } as Entry,
      ];
    }
    if (isContinuationPreamble(content)) {
      return [
        {
          ...base,
          type: "system_event",
          payload: { kind: "session_start", text: content },
        } as Entry,
      ];
    }
    return [{ ...base, type: "user_message", payload: { text: content } } as Entry];
  }

  const blocks = asBlocks(content);
  const emittedBlocks = blocks.filter(
    (block) => block.type === "text" || block.type === "tool_result",
  );
  const stableId = entryId(envelope);
  const userBlockIds = emittedBlocks.map(() => pickBlockId(stableId, emittedBlocks.length));
  const userFirstId = userBlockIds[0];
  return emittedBlocks.flatMap((block, emittedIndex) => {
    const id = userBlockIds[emittedIndex] ?? "";
    const envelopeRef = emittedIndex > 0 ? userFirstId : undefined;
    const base = baseEntry(envelope, id, block.type, block, emittedIndex, { envelopeRef });
    if (base === undefined) return [];
    if (block.type === "text" && typeof block.text === "string") {
      const text = block.text;
      const interrupt = isInterruptMarker(text);
      if (interrupt !== undefined) {
        return [
          {
            ...base,
            type: "user_interrupt",
            payload: { reason: interrupt.reason },
          } as Entry,
        ];
      }
      return [
        isContinuationPreamble(text)
          ? ({
              ...base,
              type: "system_event",
              payload: { kind: "x-claudecode/system", text },
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
  const stableId = entryId(envelope);
  const asstBlockIds = emittedBlocks.map(() => pickBlockId(stableId, emittedBlocks.length));
  const asstFirstId = asstBlockIds[0];
  const envelopeUsage = mapAgentMessageUsage(envelope.message?.usage);
  let usageEmitted = false;
  return emittedBlocks.flatMap((block, emittedIndex) => {
    const id = asstBlockIds[emittedIndex] ?? "";
    const envelopeRef = emittedIndex > 0 ? asstFirstId : undefined;
    const base = baseEntry(envelope, id, block.type, block, emittedIndex, { envelopeRef });
    if (base === undefined) return [];
    const model = envelope.message?.model;
    if (block.type === "text" && typeof block.text === "string") {
      const usage = !usageEmitted ? envelopeUsage : undefined;
      if (usage !== undefined) usageEmitted = true;
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
            ...(usage !== undefined ? { usage } : {}),
          },
        } as Entry,
      ];
    }
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      const text =
        stringValue(block.thinking) ??
        stringValue(block.data) ??
        (block.type === "redacted_thinking" ? "[redacted thinking]" : "");
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
  // queue-operation and pr-link envelopes lack `uuid` across many Claude Code
  // versions (null or absent). The mapper synthesizes an id for those types,
  // so the uuid presence check is relaxed for them.
  const allowsSynthesizedId = envelope.type === "queue-operation" || envelope.type === "pr-link";
  if (
    (!allowsSynthesizedId && typeof envelope.uuid !== "string") ||
    envelope.timestamp === undefined
  ) {
    return [];
  }

  if (
    envelope.type === "system" ||
    envelope.type === "progress" ||
    envelope.type === "queue-operation" ||
    envelope.type === "pr-link"
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
