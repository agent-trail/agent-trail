import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { isObject, numericValue, type PiEnvelope, stringValue } from "../source.ts";
import type { PiMappingContext } from "./context.ts";
import { type Meta, metaFor } from "./shared.ts";

function emitCustom(
  ctx: PiMappingContext,
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
): TrailEntryDraft[] {
  const { customType, isMessage } = args;
  const inner = isObject(args.data) ? args.data : undefined;
  const content = stringValue(args.content);
  if (isMessage && customType === "interactive-shell-transfer") {
    const data: Record<string, unknown> = { custom_type: customType };
    const sessionId = stringValue(inner?.sessionId);
    if (sessionId !== undefined) data.session_id = sessionId;
    const duration = stringValue(inner?.duration);
    if (duration !== undefined) data.duration = duration;
    if ("exitCode" in (inner ?? {})) data.exit_code = inner?.exitCode ?? null;
    if (typeof inner?.timedOut === "boolean") data.timed_out = inner.timedOut;
    if (typeof inner?.cancelled === "boolean") data.cancelled = inner.cancelled;
    const completionOutput = isObject(inner?.completionOutput) ? inner.completionOutput : undefined;
    const totalLines = numericValue(completionOutput?.totalLines);
    if (totalLines !== undefined) data.output_total_lines = totalLines;
    if (typeof completionOutput?.truncated === "boolean") {
      data.output_truncated = completionOutput.truncated;
    }
    if (Array.isArray(completionOutput?.lines)) {
      data.output_line_count = completionOutput.lines.length;
    }
    return [
      {
        type: "system_event",
        payload: {
          kind: "x-pi/interactive_shell_transfer",
          text:
            content !== undefined && content.trim().length > 0
              ? content
              : "Interactive shell transfer",
          data,
        },
        source: ctx.src(record, originalType),
        meta: metaFor(
          record,
          rawType,
          typeof args.display === "boolean" ? { "dev.pi.display": args.display } : undefined,
        ),
      },
    ];
  }
  const data: Record<string, unknown> = {};
  if (customType !== undefined) data.custom_type = customType;
  if (inner !== undefined) data.custom_data = inner;
  const text =
    content !== undefined && content.trim().length > 0
      ? content
      : customType !== undefined
        ? `${isMessage ? "Custom message" : "Custom"}: ${customType}`
        : isMessage
          ? "Custom message"
          : "Custom event";
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
      source: ctx.src(record, originalType),
      meta: metaFor(record, rawType, extraMeta),
    },
  ];
}

export function customVariantMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const customMessageVariant = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "custom" } },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const msg = record.message;
      return emitCustom(
        ctx,
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

  return [customMessageVariant];
}

export function customMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const custom = defineMapping<PiEnvelope>({
    match: { type: "custom" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      return emitCustom(
        ctx,
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
      if (ctx.emittableTs(record) === null) return [];
      return emitCustom(
        ctx,
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

  return [custom, customMessage];
}
