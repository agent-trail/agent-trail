import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping, mapAgentMessageUsage } from "@agent-trail/adapter-kit";
import type { ToolKind } from "@agent-trail/types";
import { sourceFor } from "./entry-metadata.ts";
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
} from "./source.ts";
import { toolKindAndArgs } from "./tools.ts";

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

  // Shared draft builders. Pi records branch summaries, compactions, and custom
  // content in two declaration-merged forms: as top-level tree entries
  // (`type:"branch_summary"` …) and as message-channel variants
  // (`type:"message"` with `message.role:"branchSummary"` …). Both forms map to
  // the same trail entry; these builders keep the two paths identical.
  const emitBranchSummary = (
    record: PiEnvelope,
    summary: string,
    fromId: string,
    originalType: string,
    rawType: string,
    extras?: { details?: Record<string, unknown>; fromHook?: unknown },
  ): TrailEntryDraft[] => {
    const extraMeta: Meta = {};
    if (extras?.details !== undefined) extraMeta["dev.pi.branch_details"] = extras.details;
    // #5: fromHook distinguishes a hook-triggered branch return from a user one.
    if (typeof extras?.fromHook === "boolean")
      extraMeta["dev.pi.branch_from_hook"] = extras.fromHook;
    return [
      {
        // abandoned_branch_id starts as the raw fromId; piParentResolution refines
        // it to the abandoned branch's root entry id (divergence walk).
        type: "branch_summary",
        payload: { abandoned_branch_id: fromId, summary },
        source: src(record, originalType),
        meta: metaFor(record, rawType, Object.keys(extraMeta).length > 0 ? extraMeta : undefined, {
          fromId,
        }),
      },
    ];
  };

  const emitCompaction = (
    record: PiEnvelope,
    summary: string,
    tokensBefore: number | undefined,
    originalType: string,
    rawType: string,
    piMeta?: Record<string, unknown>,
  ): TrailEntryDraft[] => [
    {
      type: "context_compact",
      payload: {
        summary,
        ...(tokensBefore !== undefined ? { tokens_before: tokensBefore } : {}),
        trigger: "auto",
      },
      source: src(record, originalType),
      meta: metaFor(
        record,
        rawType,
        piMeta !== undefined && Object.keys(piMeta).length > 0
          ? { "dev.pi.compaction": piMeta }
          : undefined,
      ),
    },
  ];

  const emitCustom = (
    record: PiEnvelope,
    args: {
      customType: string | undefined;
      content: unknown;
      data: unknown;
      display: unknown;
      isMessage: boolean;
    },
    originalType: string,
    rawType: string,
  ): TrailEntryDraft[] => {
    const { customType, isMessage } = args;
    const data: Record<string, unknown> = {};
    if (customType !== undefined) data.custom_type = customType;
    const inner = isObject(args.data) ? args.data : undefined;
    if (inner !== undefined) data.custom_data = inner;
    const content = stringValue(args.content);
    const text =
      content !== undefined && content.trim().length > 0
        ? content
        : customType !== undefined
          ? `${isMessage ? "Custom message" : "Custom"}: ${customType}`
          : isMessage
            ? "Custom message"
            : "Custom event";
    // #12: display is UI-only visibility; surface it without conflating it into
    // the event's presence. Never drop display:false — interchange keeps it.
    const extraMeta: Meta | undefined =
      typeof args.display === "boolean" ? { "dev.pi.display": args.display } : undefined;
    return [
      {
        type: "system_event",
        payload: {
          kind: isMessage ? "x-pi/custom_message" : "x-pi/custom",
          text,
          ...(Object.keys(data).length > 0 ? { data } : {}),
        },
        source: src(record, originalType),
        meta: metaFor(record, rawType, extraMeta),
      },
    ];
  };

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
      const details = isObject(record.message?.details) ? record.message.details : undefined;
      const toolMetadata = isObject(details?.toolMetadata) ? details.toolMetadata : undefined;
      const contextAtCompletion = isObject(toolMetadata?.contextAtCompletion)
        ? toolMetadata.contextAtCompletion
        : undefined;
      // #14: surface the source toolName. Name-based call/result pairing is not
      // attempted (ambiguous when a tool is called more than once) — for_id is
      // set by the built-in toolLinking pass via call_id — but the name is
      // preserved for consumers.
      const toolName = stringValue(record.message?.toolName);
      const piMeta: Record<string, unknown> = {};
      if (contextAtCompletion !== undefined)
        piMeta["dev.pi.context_at_completion"] = contextAtCompletion;
      if (toolName !== undefined) piMeta["dev.pi.tool_name"] = toolName;
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
            ...metaFor(
              record,
              "tool_result_envelope",
              Object.keys(piMeta).length > 0 ? piMeta : undefined,
            ),
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
      return emitBranchSummary(
        record,
        summary,
        fromId,
        "branch_summary",
        "branch_summary_envelope",
        {
          details,
          fromHook: record.fromHook,
        },
      );
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
      return emitCompaction(
        record,
        summary,
        tokensBefore,
        "compaction",
        "compaction_envelope",
        piMeta,
      );
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
      if (name === undefined) return [];
      return [
        {
          type: "session_metadata_update",
          payload: { field: "name", value: name, reason: "ai_generated" },
          source: src(record, "session_info"),
          meta: metaFor(record, "session_info_envelope"),
        },
      ];
    },
  });

  // CustomEntry carries its payload under `data`; CustomMessageEntry under
  // `details` + a `display` flag (pi harness types). Normalize both here.
  const custom = defineMapping<PiEnvelope>({
    match: { type: "custom" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      return emitCustom(
        record,
        {
          customType: stringValue(record.customType),
          content: record.content,
          data: record.data,
          display: undefined,
          isMessage: false,
        },
        "custom",
        "custom_envelope",
      );
    },
  });

  const customMessage = defineMapping<PiEnvelope>({
    match: { type: "custom_message" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      return emitCustom(
        record,
        {
          customType: stringValue(record.customType),
          content: record.content,
          data: record.details,
          display: record.display,
          isMessage: true,
        },
        "custom_message",
        "custom_message_envelope",
      );
    },
  });

  // Message-channel variants: `type:"message"` envelopes whose `message.role` is a
  // declaration-merged coding-agent type. Fields live on `message`, not content.
  const bashExecution = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "bashExecution" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const msg = record.message;
      const command = stringValue(msg?.command);
      if (command === undefined) return [];
      // No native Pi call id for `!` shell — synthesize one so the built-in
      // toolLinking pass pairs the call with its result.
      const callId = `x-pi/bash:${record.id}`;
      const cancelled = msg?.cancelled === true;
      const exitCode = typeof msg?.exitCode === "number" ? msg.exitCode : undefined;
      const ok = !cancelled && (exitCode === undefined || exitCode === 0);
      const output = stringValue(msg?.output);
      // user-origin marker + the bash fields the spec shell_command shape can't hold.
      const callMeta: Record<string, unknown> = { "dev.pi.user_shell": true };
      if (msg?.excludeFromContext === true) callMeta["dev.pi.exclude_from_context"] = true;
      const shellMeta: Record<string, unknown> = {};
      if (exitCode !== undefined) shellMeta.exit_code = exitCode;
      // payload.truncated requires payload.output_size (schema dependentSchemas);
      // Pi gives no original byte length, so record truncation in meta instead.
      const resultMeta: Record<string, unknown> = {};
      if (msg?.truncated === true) resultMeta["dev.pi.truncated"] = true;
      if (cancelled) resultMeta["dev.pi.cancelled"] = true;
      if (stringValue(msg?.fullOutputPath) !== undefined)
        resultMeta["dev.pi.full_output_path"] = msg?.fullOutputPath;
      return [
        {
          type: "tool_call",
          payload: { tool: "shell_command", args: { command } },
          semantic: { call_id: callId, tool_kind: "shell_command" },
          source: src(record, "bashExecution"),
          meta: {
            linker: { call_id: callId },
            ...metaFor(record, "bash_execution_call", callMeta),
          },
        },
        {
          type: "tool_result",
          payload: {
            ok,
            ...(output !== undefined && output.length > 0 ? { output } : {}),
            ...(cancelled ? { error: "command cancelled" } : {}),
            ...(Object.keys(shellMeta).length > 0 ? { meta: { shell_command: shellMeta } } : {}),
          },
          semantic: { call_id: callId, tool_kind: "shell_command" },
          source: src(record, "bashExecution"),
          meta: {
            linker: { call_id: callId },
            ...metaFor(
              record,
              "bash_execution_result",
              Object.keys(resultMeta).length > 0 ? resultMeta : undefined,
            ),
          },
        },
      ];
    },
  });

  const customMessageVariant = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "custom" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const msg = record.message;
      return emitCustom(
        record,
        {
          customType: stringValue(msg?.customType),
          content: msg?.content,
          data: msg?.details,
          display: msg?.display,
          isMessage: true,
        },
        "custom_message_variant",
        "custom_message_variant",
      );
    },
  });

  const branchSummaryVariant = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "branchSummary" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const summary = stringValue(record.message?.summary);
      const fromId = stringValue(record.message?.fromId);
      if (summary === undefined || fromId === undefined) return [];
      return emitBranchSummary(
        record,
        summary,
        fromId,
        "branchSummaryMessage",
        "branch_summary_message",
      );
    },
  });

  const compactionSummaryVariant = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "compactionSummary" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const summary = stringValue(record.message?.summary);
      if (summary === undefined) return [];
      const tokensBefore = numericValue(record.message?.tokensBefore);
      return emitCompaction(
        record,
        summary,
        tokensBefore,
        "compactionSummaryMessage",
        "compaction_message",
      );
    },
  });

  // #1: LeafEntry — Pi's authoritative active-branch-tip pointer. Emitted as a
  // state signal; piParentResolution resolves data.leaf_id to the mapped entry id
  // and uses the pointer when refining branch_summary.abandoned_branch_id.
  const leaf = defineMapping<PiEnvelope>({
    match: { type: "leaf" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const target = stringValue(record.targetId);
      return [
        {
          type: "system_event",
          payload: {
            kind: "x-pi/leaf_change",
            text: target !== undefined ? "Active branch tip moved" : "Active branch tip cleared",
            // raw Pi targetId; piParentResolution rewrites it to the mapped entry id.
            ...(target !== undefined ? { data: { leaf_id: target } } : {}),
          },
          source: src(record, "leaf"),
          meta: metaFor(record, "leaf_envelope"),
        },
      ];
    },
  });

  // #2: LabelEntry — targetId+label annotation. piParentResolution resolves
  // data.target_id to the mapped entry id.
  const label = defineMapping<PiEnvelope>({
    match: { type: "label" },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const target = stringValue(record.targetId);
      if (target === undefined) return [];
      const labelText = stringValue(record.label);
      return [
        {
          type: "system_event",
          payload: {
            kind: "x-pi/label",
            text: labelText !== undefined ? `Label: ${labelText}` : "Label",
            data: { target_id: target, ...(labelText !== undefined ? { label: labelText } : {}) },
          },
          source: src(record, "label"),
          meta: metaFor(record, "label_envelope"),
        },
      ];
    },
  });

  // #13 drift defense for unknown top-level types is handled upstream of dispatch
  // by the source-schema drift mechanism (defineAdapter): a `type` outside the
  // pi/v1 enum fails validation and is quarantined as `x-pi/unknown_record`
  // (lossless, raw on source.raw). `leaf`/`label` are now in that enum so they
  // route to the typed mappings below instead of generic quarantine.

  return [
    userMessage,
    assistantMessage,
    toolResult,
    bashExecution,
    customMessageVariant,
    branchSummaryVariant,
    compactionSummaryVariant,
    branchSummary,
    compaction,
    modelChange,
    thinkingLevelChange,
    sessionInfo,
    custom,
    customMessage,
    leaf,
    label,
  ];
}
