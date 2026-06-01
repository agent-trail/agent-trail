import { createHash } from "node:crypto";
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
  jsonString,
  stringValue,
  textFromToolResultContent,
} from "./source.ts";
import { toolKindAndArgs } from "./tools.ts";

type Raw = Record<string, unknown>;
type UserQueryOption = { label: string; description?: string };

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

function questionId(question: string): string {
  return `q_${createHash("sha256").update(question).digest("hex").slice(0, 12)}`;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionObjects(value: unknown): UserQueryOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value
    .map((option) => {
      if (typeof option === "string") return { label: option };
      if (option === null || typeof option !== "object") return undefined;
      const label = stringValue((option as { label?: unknown }).label);
      if (label === undefined) return undefined;
      const description = stringValue((option as { description?: unknown }).description);
      return { label, ...(description !== undefined ? { description } : {}) };
    })
    .filter((option): option is UserQueryOption => option !== undefined);
  return options.length === value.length ? options : undefined;
}

function userQueryQuestion(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const question = stringValue(raw.question);
  if (question === undefined) return undefined;
  const out: Record<string, unknown> = {
    id: stringValue(raw.id) ?? questionId(question),
    question,
  };
  const header = stringValue(raw.header);
  if (header !== undefined) out.header = header;
  const multiSelect = booleanValue(raw.multi_select) ?? booleanValue(raw.multiSelect);
  if (multiSelect !== undefined) out.multi_select = multiSelect;
  const isSecret = booleanValue(raw.is_secret) ?? booleanValue(raw.isSecret);
  if (isSecret !== undefined) out.is_secret = isSecret;
  const allowOther =
    booleanValue(raw.allow_other) ?? booleanValue(raw.allowOther) ?? booleanValue(raw.is_other);
  if (allowOther !== undefined) out.allow_other = allowOther;
  const options = optionObjects(raw.options) ?? optionObjects(raw.choices);
  if (options !== undefined) out.options = options;
  return out;
}

function userQueryPayload(input: unknown): { questions: Record<string, unknown>[] } | undefined {
  const args =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (Array.isArray(args.questions)) {
    const questions = args.questions
      .filter(
        (question): question is Record<string, unknown> =>
          question !== null && typeof question === "object",
      )
      .map(userQueryQuestion)
      .filter((question): question is Record<string, unknown> => question !== undefined);
    if (questions.length > 0) return { questions };
  }
  const question = userQueryQuestion(args);
  return question !== undefined ? { questions: [question] } : undefined;
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
        if (stringValue(block.name) === "AskUserQuestion") {
          const payload = userQueryPayload(block.input);
          if (payload !== undefined) {
            return [
              {
                type: "user_query",
                payload,
                semantic: { ...(callId !== undefined ? { call_id: callId } : {}) },
                source,
                meta: meta(record, { model, callId }),
              },
            ];
          }
        }
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

export const claudeCodeMappings: MappingDef<Raw>[] = [
  userMessage,
  assistantMessage,
  summary,
  systemEvent("system", false),
  systemEvent("progress", false),
  systemEvent("queue-operation", true),
  systemEvent("pr-link", true),
  permissionMode,
];
