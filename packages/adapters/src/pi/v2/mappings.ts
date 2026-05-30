import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping, mapAgentMessageUsage } from "@agent-trail/adapter-kit";
import type { ToolKind } from "@agent-trail/types";
import { sourceFor } from "../entry-metadata.ts";
import {
  asBlocks,
  idValue,
  isObject,
  numericValue,
  type PiBlock,
  type PiEnvelope,
  stringValue,
  textFromContent,
  timestampToIso,
} from "../source.ts";
import { toolKindAndArgs } from "../tools.ts";

/**
 * Internal parenting hint stashed on `meta` by the mappings and consumed +
 * stripped by `piParentResolution` (reconcile-rules.ts). Carries the Pi source
 * id and parent source id (and, for branch summaries, the raw `fromId`) so the
 * tree topology — which the kit engine cannot see from a per-record mapping —
 * can be rebuilt after ids are assigned. Never appears in final output.
 */
export const PARENT_HINT = "x-pi/_h";

export interface ParentHint {
  sid: string;
  pid: string | null;
  fromId?: string;
  /**
   * Model of the source assistant envelope, carried on every entry it emits so
   * piModelChangeFromModel can advance `prevModel` per source envelope (matching
   * v1) — including tool_call-only / thinking-only messages whose entries carry
   * no model in their own payload.
   */
  model?: string;
}

type Meta = Record<string, unknown>;

interface HintExtras {
  fromId?: string;
  model?: string;
}

function metaFor(record: PiEnvelope, rawType: string, extra?: Meta, hintExtras?: HintExtras): Meta {
  const hint: ParentHint = {
    sid: record.id as string,
    pid: record.parentId ?? null,
    ...(hintExtras?.fromId !== undefined ? { fromId: hintExtras.fromId } : {}),
    ...(hintExtras?.model !== undefined ? { model: hintExtras.model } : {}),
  };
  return {
    ...(extra ?? {}),
    "dev.pi.raw_type": rawType,
    [PARENT_HINT]: hint,
  };
}

/**
 * Build a mapping set bound to the session's source `version` string (e.g. "3").
 * v1 stamps `source.schema_version` from the session record's version on every
 * entry (message records carry no version of their own), so v2 must thread it
 * through the shared `sourceFor` helper to reproduce `source` byte-for-byte.
 */
export function makePiMappings(sessionVersion: string | undefined): MappingDef<PiEnvelope>[] {
  // Guard mirroring v1 `buildEntries` (id/timestamp gate) + `baseEntry` (drop on
  // unparseable ts). Returns the ISO ts when the record is emittable, else null.
  const emittableTs = (record: PiEnvelope): string | null => {
    if (record.id === undefined) return null;
    return timestampToIso(record.timestamp) ?? null;
  };

  const src = (
    record: PiEnvelope,
    originalType: string | undefined,
    block?: PiBlock,
    blockIndex?: number,
    options?: { synthesized?: boolean; envelopeRef?: string },
  ) =>
    sourceFor(record, originalType, block, blockIndex, {
      schemaVersion: sessionVersion,
      ...options,
    });

  const userMessage = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "user" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const content = record.message?.content;
      const text = typeof content === "string" ? content : textFromContent(content);
      return [
        {
          type: "user_message",
          payload: { text },
          source: src(record, "message"),
          meta: metaFor(record, "user_message_envelope"),
        },
      ];
    },
  });

  const assistantMessage = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "assistant" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const aborted = record.message?.stopReason === "aborted";
      const content = record.message?.content;
      const usage = mapAgentMessageUsage(record.message?.usage);
      const model = stringValue(record.message?.model);
      const stopReason = stringValue(record.message?.stopReason);

      const out: TrailEntryDraft[] = [];

      if (typeof content === "string") {
        out.push({
          type: "agent_message",
          payload: {
            text: content,
            ...(model !== undefined ? { model } : {}),
            ...(stopReason !== undefined ? { stop_reason: stopReason } : {}),
            ...(usage !== undefined ? { usage } : {}),
          },
          source: src(record, "message"),
          meta: metaFor(record, "assistant_string_content", undefined, { model }),
        });
      } else {
        const blocks = asBlocks(content);
        const emittable: Array<{ block: PiBlock; originalIndex: number }> = [];
        blocks.forEach((block, originalIndex) => {
          if (block.type === "text" || block.type === "toolCall" || block.type === "thinking") {
            emittable.push({ block, originalIndex });
          }
        });
        let usageEmitted = false;
        emittable.forEach(({ block, originalIndex }, emittedIndex) => {
          // Non-first blocks reference the first block's entry id via
          // source.raw.envelope_ref. The real id is unknown until the engine
          // assigns it, so emit a placeholder to get the {envelope_ref,...} raw
          // shape; piParentResolution backfills the real id in pass 2.
          const envelopeRef = emittedIndex > 0 ? "" : undefined;
          if (block.type === "text" && typeof block.text === "string") {
            const blockUsage = !usageEmitted ? usage : undefined;
            if (blockUsage !== undefined) usageEmitted = true;
            out.push({
              type: "agent_message",
              payload: {
                text: block.text,
                ...(model !== undefined ? { model } : {}),
                ...(stopReason !== undefined ? { stop_reason: stopReason } : {}),
                ...(blockUsage !== undefined ? { usage: blockUsage } : {}),
              },
              source: src(record, "text", block, originalIndex, { envelopeRef }),
              meta: metaFor(record, "assistant_text_block", undefined, { model }),
            });
          } else if (block.type === "thinking") {
            const rawThinking = typeof block.thinking === "string" ? block.thinking : "";
            const redacted = block.redacted === true && rawThinking.length === 0;
            out.push({
              type: "agent_thinking",
              payload: {
                text: redacted ? "[redacted thinking]" : rawThinking,
                ...(model !== undefined ? { model } : {}),
              },
              source: src(record, "thinking", block, originalIndex, { envelopeRef }),
              meta: metaFor(
                record,
                redacted ? "assistant_redacted_thinking_block" : "assistant_thinking_block",
                undefined,
                { model },
              ),
            });
          } else if (block.type === "toolCall") {
            const name = stringValue(block.name);
            const callId = idValue(block.id);
            const mapped = toolKindAndArgs(name, block.arguments);
            out.push({
              type: "tool_call",
              payload: mapped,
              semantic: {
                ...(callId !== undefined ? { call_id: callId } : {}),
                tool_kind: mapped.tool as ToolKind,
              },
              source: src(record, "toolCall", block, originalIndex, { envelopeRef }),
              meta: {
                ...(callId !== undefined ? { linker: { call_id: callId } } : {}),
                ...metaFor(record, "assistant_toolcall_block", undefined, { model }),
              },
            });
          }
        });
      }

      if (aborted) {
        out.push({
          type: "user_interrupt",
          payload: { reason: "stop_reason_aborted" },
          source: src(record, "assistant", undefined, undefined, { synthesized: true }),
          meta: metaFor(record, "aborted_assistant_synthetic", undefined, { model }),
        });
      }
      return out;
    },
  });

  const toolResult = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "toolResult" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const callId = idValue(record.message?.toolCallId);
      const ok = record.message?.isError !== true;
      const output = textFromContent(record.message?.content);
      return [
        {
          type: "tool_result",
          payload: {
            ok,
            ...(output.length > 0 ? { output } : {}),
            ...(!ok && output.length > 0 ? { error: output } : {}),
          },
          // tool_kind is copied from the linked tool_call by piToolKindToResult;
          // call_id/for_id are filled by the built-in toolLinking pass.
          source: src(record, "message"),
          meta: {
            ...(callId !== undefined ? { linker: { call_id: callId } } : {}),
            ...metaFor(record, "tool_result_envelope"),
          },
        },
      ];
    },
  });

  const branchSummary = defineMapping<PiEnvelope>({
    match: { type: "branch_summary" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const summary = stringValue(record.summary);
      const fromId = stringValue(record.fromId);
      if (summary === undefined || fromId === undefined) return [];
      const details = isObject(record.details) ? record.details : undefined;
      return [
        {
          // abandoned_branch_id starts as the raw fromId; piParentResolution
          // refines it to the abandoned branch's root entry id (divergence walk).
          type: "branch_summary",
          payload: { abandoned_branch_id: fromId, summary },
          source: src(record, "branch_summary"),
          meta: metaFor(
            record,
            "branch_summary_envelope",
            details !== undefined ? { "dev.pi.branch_details": details } : undefined,
            { fromId },
          ),
        },
      ];
    },
  });

  const compaction = defineMapping<PiEnvelope>({
    match: { type: "compaction" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const summary = stringValue(record.summary);
      if (summary === undefined) return [];
      const tokensBefore = numericValue(record.tokensBefore);
      const piMeta: Record<string, unknown> = {};
      if (record.firstKeptEntryId !== undefined) piMeta.firstKeptEntryId = record.firstKeptEntryId;
      if (record.details !== undefined) piMeta.details = record.details;
      if (record.fromHook !== undefined) piMeta.fromHook = record.fromHook;
      return [
        {
          type: "context_compact",
          payload: {
            summary,
            ...(tokensBefore !== undefined ? { tokens_before: tokensBefore } : {}),
            trigger: "auto",
          },
          source: src(record, "compaction"),
          meta: metaFor(
            record,
            "compaction_envelope",
            Object.keys(piMeta).length > 0 ? { "dev.pi.compaction": piMeta } : undefined,
          ),
        },
      ];
    },
  });

  const modelChange = defineMapping<PiEnvelope>({
    match: { type: "model_change" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const toModel = stringValue(record.modelId);
      if (toModel === undefined) return [];
      const provider = stringValue(record.provider);
      return [
        {
          // from_model is filled by piModelChangeFromModel (needs prior model).
          type: "model_change",
          payload: { to_model: toModel },
          source: src(record, "model_change"),
          meta: metaFor(
            record,
            "model_change_envelope",
            provider !== undefined ? { "dev.pi.model_change": { provider } } : undefined,
          ),
        },
      ];
    },
  });

  const thinkingLevelChange = defineMapping<PiEnvelope>({
    match: { type: "thinking_level_change" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const level = stringValue(record.thinkingLevel);
      return [
        {
          type: "system_event",
          payload: {
            kind: "x-pi/thinking_level_change",
            text: level !== undefined ? `Thinking level set to ${level}` : "Thinking level change",
            ...(level !== undefined ? { data: { thinking_level: level } } : {}),
          },
          source: src(record, "thinking_level_change"),
          meta: metaFor(record, "thinking_level_change_envelope"),
        },
      ];
    },
  });

  const sessionInfo = defineMapping<PiEnvelope>({
    match: { type: "session_info" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const name = stringValue(record.name);
      return [
        {
          type: "system_event",
          payload: {
            kind: "x-pi/session_info",
            text: name !== undefined ? `Session info: ${name}` : "Session info",
            ...(name !== undefined ? { data: { name } } : {}),
          },
          source: src(record, "session_info"),
          meta: metaFor(record, "session_info_envelope"),
        },
      ];
    },
  });

  const customEmit = (record: PiEnvelope, isMessage: boolean): TrailEntryDraft[] => {
    if (emittableTs(record) === null) return [];
    const customType = stringValue(record.customType);
    const data: Record<string, unknown> = {};
    if (customType !== undefined) data.custom_type = customType;
    const inner = isObject(record.data) ? record.data : undefined;
    if (inner !== undefined) data.custom_data = inner;
    const content = stringValue(record.content);
    const text =
      content !== undefined && content.trim().length > 0
        ? content
        : customType !== undefined
          ? `${isMessage ? "Custom message" : "Custom"}: ${customType}`
          : isMessage
            ? "Custom message"
            : "Custom event";
    return [
      {
        type: "system_event",
        payload: {
          kind: isMessage ? "x-pi/custom_message" : "x-pi/custom",
          text,
          ...(Object.keys(data).length > 0 ? { data } : {}),
        },
        source: src(record, isMessage ? "custom_message" : "custom"),
        meta: metaFor(record, isMessage ? "custom_message_envelope" : "custom_envelope"),
      },
    ];
  };

  const custom = defineMapping<PiEnvelope>({
    match: { type: "custom" },
    emit: (record) => customEmit(record, false),
  });

  const customMessage = defineMapping<PiEnvelope>({
    match: { type: "custom_message" },
    emit: (record) => customEmit(record, true),
  });

  return [
    userMessage,
    assistantMessage,
    toolResult,
    branchSummary,
    compaction,
    modelChange,
    thinkingLevelChange,
    sessionInfo,
    custom,
    customMessage,
  ];
}
