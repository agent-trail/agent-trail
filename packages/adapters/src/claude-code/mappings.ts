import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping, mapAgentMessageUsage } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import { sourceFor } from "./entry-metadata.ts";
import { systemEventData, systemEventKind, systemEventText } from "./envelope-mappers.ts";
import {
  asBlocks,
  type CcBlock,
  type CcEnvelope,
  isContinuationPreamble,
  isInterruptMarker,
  isObject,
  jsonString,
  stringValue,
  textFromToolResultContent,
} from "./source.ts";
import { toolKindAndArgs } from "./tools.ts";

type Raw = Record<string, unknown>;

/**
 * Transient hint stashed on `meta`: source uuid (`sid`, for multi-block
 * envelope_ref backfill + model grouping) and the source assistant `model` (for
 * the synthesized model_change rule). Stripped by ccEnvelopeRefBackfill before
 * output — v1 Claude Code entries carry no entry-level meta.
 */
export const HINT = "x-claudecode/_h";

export interface CcHint {
  sid?: string;
  model?: string;
}

function meta(
  record: CcEnvelope,
  opts?: { model?: string; callId?: string },
): Record<string, unknown> {
  const hint: CcHint = {
    ...(typeof record.uuid === "string" ? { sid: record.uuid } : {}),
    ...(opts?.model !== undefined ? { model: opts.model } : {}),
  };
  return {
    ...(opts?.callId !== undefined ? { linker: { call_id: opts.callId } } : {}),
    [HINT]: hint,
  };
}

function src(
  record: CcEnvelope,
  originalType: string,
  block?: CcBlock,
  blockIndex?: number,
  options?: { synthesized?: boolean; envelopeRef?: string },
): Entry["source"] {
  return sourceFor(record, originalType, block, blockIndex, options);
}

// Mirrors v1 buildEntries gate: drop sidechain/meta envelopes and records
// without a timestamp; require a uuid except where v1 synthesizes one.
function gate(record: CcEnvelope, allowNoUuid = false): boolean {
  if (record.isSidechain === true || record.isMeta === true) return false;
  if (typeof record.timestamp !== "string") return false;
  if (!allowNoUuid && typeof record.uuid !== "string") return false;
  return true;
}

const userMessage = defineMapping<Raw>({
  match: { type: "user" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record)) return [];
    const content = record.message?.content;
    if (typeof content === "string") {
      const interrupt = isInterruptMarker(content);
      if (interrupt !== undefined) {
        return [
          {
            type: "user_interrupt",
            payload: { reason: interrupt.reason },
            source: src(record, "user"),
            meta: meta(record),
          },
        ];
      }
      if (isContinuationPreamble(content)) {
        return [
          {
            type: "system_event",
            payload: { kind: "session_start", text: content },
            source: src(record, "user"),
            meta: meta(record),
          },
        ];
      }
      return [
        {
          type: "user_message",
          payload: { text: content },
          source: src(record, "user"),
          meta: meta(record),
        },
      ];
    }
    const blocks = asBlocks(content).filter((b) => b.type === "text" || b.type === "tool_result");
    return blocks.flatMap((block, i): TrailEntryDraft[] => {
      const envelopeRef = i > 0 ? "" : undefined;
      const source = src(record, String(block.type), block, i, { envelopeRef });
      if (block.type === "text" && typeof block.text === "string") {
        const interrupt = isInterruptMarker(block.text);
        if (interrupt !== undefined) {
          return [
            {
              type: "user_interrupt",
              payload: { reason: interrupt.reason },
              source,
              meta: meta(record),
            },
          ];
        }
        if (isContinuationPreamble(block.text)) {
          return [
            {
              type: "system_event",
              payload: { kind: "x-claudecode/system", text: block.text },
              source,
              meta: meta(record),
            },
          ];
        }
        return [
          { type: "user_message", payload: { text: block.text }, source, meta: meta(record) },
        ];
      }
      if (block.type === "tool_result") {
        const callId = stringValue(block.tool_use_id);
        const ok = block.is_error !== true;
        const output = textFromToolResultContent(block.content);
        return [
          {
            type: "tool_result",
            payload: {
              ok,
              ...(output.length > 0 ? { output } : {}),
              ...(!ok && output.length > 0 ? { error: output } : {}),
            },
            source,
            meta: meta(record, { callId }),
          },
        ];
      }
      return [];
    });
  },
});

const assistantMessage = defineMapping<Raw>({
  match: { type: "assistant" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record)) return [];
    const blocks = asBlocks(record.message?.content).filter(
      (b) =>
        b.type === "text" ||
        b.type === "thinking" ||
        b.type === "redacted_thinking" ||
        b.type === "tool_use",
    );
    const model = stringValue(record.message?.model);
    const usage = mapAgentMessageUsage(record.message?.usage);
    let usageEmitted = false;
    return blocks.flatMap((block, i): TrailEntryDraft[] => {
      const envelopeRef = i > 0 ? "" : undefined;
      const source = src(record, String(block.type), block, i, { envelopeRef });
      if (block.type === "text" && typeof block.text === "string") {
        const blockUsage = !usageEmitted ? usage : undefined;
        if (blockUsage !== undefined) usageEmitted = true;
        return [
          {
            type: "agent_message",
            payload: {
              text: block.text,
              ...(model !== undefined ? { model } : {}),
              ...(typeof record.message?.stop_reason === "string"
                ? { stop_reason: record.message.stop_reason }
                : {}),
              ...(blockUsage !== undefined ? { usage: blockUsage } : {}),
            },
            source,
            meta: meta(record, { model }),
          },
        ];
      }
      if (block.type === "thinking" || block.type === "redacted_thinking") {
        const text =
          stringValue(block.thinking) ??
          stringValue(block.data) ??
          (block.type === "redacted_thinking" ? "[redacted thinking]" : "");
        return [
          {
            type: "agent_thinking",
            payload: { text, ...(model !== undefined ? { model } : {}) },
            source,
            meta: meta(record, { model }),
          },
        ];
      }
      if (block.type === "tool_use") {
        const callId = stringValue(block.id);
        const mapped = toolKindAndArgs(stringValue(block.name), block.input);
        return [
          {
            type: "tool_call",
            payload: mapped,
            semantic: {
              ...(callId !== undefined ? { call_id: callId } : {}),
              tool_kind: mapped.tool as ToolKind,
            },
            source,
            meta: meta(record, { model, callId }),
          },
        ];
      }
      return [];
    });
  },
});

const summary = defineMapping<Raw>({
  match: { type: "summary" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record)) return [];
    const text =
      stringValue(record.summary) ??
      stringValue(record.message?.content) ??
      jsonString(record.message?.content);
    if (record.isCompactSummary === true) {
      return [
        {
          type: "context_compact",
          payload: { summary: text, trigger: "auto" },
          source: src(record, "summary"),
          meta: meta(record),
        },
      ];
    }
    return [
      {
        type: "session_summary",
        payload: { scope: "session", text },
        // v1 always emits a `semantic` object (empty when there is no leafUuid).
        semantic: typeof record.leafUuid === "string" ? { group_id: record.leafUuid } : {},
        source: src(record, "summary"),
        meta: meta(record),
      },
    ];
  },
});

function systemEvent(payloadType: string, allowNoUuid: boolean): MappingDef<Raw> {
  return defineMapping<Raw>({
    match: { type: payloadType },
    emit: (raw) => {
      const record = raw as CcEnvelope;
      if (!gate(record, allowNoUuid)) return [];
      const synthesized = typeof record.uuid !== "string";
      const data = systemEventData(record);
      return [
        {
          type: "system_event",
          payload: {
            kind: systemEventKind(record),
            text: systemEventText(record),
            ...(data !== undefined ? { data } : {}),
          },
          source: src(
            record,
            payloadType,
            undefined,
            undefined,
            synthesized ? { synthesized: true } : undefined,
          ),
          meta: meta(record),
        },
      ];
    },
  });
}

const permissionMode = defineMapping<Raw>({
  match: { type: "permission-mode" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const mode = stringValue(record.permissionMode);
    if (mode === undefined) return [];
    // Base entry; ccPermissionModeDelta fills data.from + delta text from the prior mode.
    return [
      {
        type: "system_event",
        payload: {
          kind: "permission_mode_change",
          text: `Permission mode: ${mode}`,
          data: { to: mode },
        },
        source: src(record, "permission-mode", undefined, undefined, { synthesized: true }),
        meta: meta(record),
      },
    ];
  },
});

type CapabilityItem = { name: string; metadata?: Record<string, unknown> };

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function skillMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const description = stringValue(value.description);
  return description === undefined ? undefined : { description };
}

function skillItems(attachment: Record<string, unknown>): CapabilityItem[] {
  const skills = Array.isArray(attachment.skills) ? attachment.skills : undefined;
  if (skills !== undefined) {
    return skills.flatMap((skill) => {
      if (typeof skill === "string") return [{ name: skill }];
      if (!isObject(skill)) return [];
      const name = stringValue(skill.name);
      if (name === undefined) return [];
      const metadata = skillMetadata(skill);
      return [{ name, ...(metadata !== undefined ? { metadata } : {}) }];
    });
  }

  return stringArray(attachment.skillNames ?? attachment.names).map((name) => ({ name }));
}

function listingText(attachment: Record<string, unknown>): string | undefined {
  const content = attachment.content ?? attachment.text;
  if (content === undefined) return undefined;
  if (typeof content === "string") return content;
  return jsonString(content);
}

const capabilityAttachment = defineMapping<Raw>({
  match: { type: "attachment" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record)) return [];
    const attachment = isObject(record.attachment) ? record.attachment : undefined;
    const subtype = stringValue(attachment?.type);
    if (attachment === undefined || subtype === undefined) return [];

    if (subtype === "deferred_tools_delta") {
      const drafts: TrailEntryDraft[] = [];
      const added = stringArray(attachment.addedNames ?? attachment.added_names).map((name) => ({
        name,
      }));
      if (added.length > 0) {
        drafts.push({
          type: "capability_change",
          payload: { scope: "tool", reason: "registered", added },
          source: src(record, "attachment.deferred_tools_delta"),
          meta: meta(record),
        });
      }
      const removed = stringArray(attachment.removedNames ?? attachment.removed_names).map(
        (name) => ({ name }),
      );
      if (removed.length > 0) {
        drafts.push({
          type: "capability_change",
          payload: { scope: "tool", reason: "deregistered", removed },
          source: src(record, "attachment.deferred_tools_delta"),
          meta: meta(record),
        });
      }
      return drafts;
    }

    if (subtype === "skill_listing") {
      const snapshot = skillItems(attachment);
      if (snapshot.length > 0) {
        return [
          {
            type: "capability_change",
            payload: { scope: "skill", reason: "loaded", snapshot },
            source: src(record, "attachment.skill_listing"),
            meta: meta(record),
          },
        ];
      }
      const text = listingText(attachment);
      if (text === undefined || text.length === 0) return [];
      return [
        {
          type: "capability_change",
          payload: {
            scope: "skill",
            reason: "loaded",
            changed: [{ name: "skill_listing", field: "listing", to: text }],
          },
          source: src(record, "attachment.skill_listing"),
          meta: meta(record),
        },
      ];
    }

    if (subtype === "mcp_instructions_delta") {
      const name =
        stringValue(attachment.serverName) ??
        stringValue(attachment.server) ??
        stringValue(attachment.name) ??
        "mcp_instructions";
      const content = listingText(attachment);
      return [
        {
          type: "capability_change",
          payload: {
            scope: "mcp_server",
            reason: "instructions_updated",
            changed: [
              {
                name,
                field: "instructions",
                ...(content !== undefined && content.length > 0 ? { to: content } : {}),
              },
            ],
          },
          source: src(record, "attachment.mcp_instructions_delta"),
          meta: meta(record),
        },
      ];
    }

    return [];
  },
});

export const claudeCodeMappings: MappingDef<Raw>[] = [
  userMessage,
  assistantMessage,
  summary,
  capabilityAttachment,
  systemEvent("system", false),
  systemEvent("progress", false),
  systemEvent("queue-operation", true),
  systemEvent("pr-link", true),
  permissionMode,
];
