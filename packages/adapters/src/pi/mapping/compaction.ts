import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { numericValue, type PiEnvelope, stringValue } from "../source.ts";
import type { PiMappingContext } from "./context.ts";
import { metaFor } from "./shared.ts";

function emitCompaction(
  ctx: PiMappingContext,
  record: PiEnvelope,
  summary: string,
  tokensBefore: number | undefined,
  originalType: string,
  rawType: string,
  piMeta?: Record<string, unknown>,
): TrailEntryDraft[] {
  return [
    {
      type: "context_compact",
      payload: {
        summary,
        ...(tokensBefore !== undefined ? { tokens_before: tokensBefore } : {}),
        trigger: "auto",
      },
      source: ctx.src(record, originalType),
      meta: metaFor(
        record,
        rawType,
        piMeta !== undefined && Object.keys(piMeta).length > 0
          ? { "dev.pi.compaction": piMeta }
          : undefined,
      ),
    },
  ];
}

export function compactionVariantMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const compactionSummaryVariant = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "compactionSummary" } },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const msg = record.message as NonNullable<PiEnvelope["message"]>;
      const summary = stringValue(msg.summary);
      if (summary === undefined) return [];
      const tokensBefore = numericValue(msg.tokensBefore);
      return emitCompaction(
        ctx,
        record,
        summary,
        tokensBefore,
        "compactionSummaryMessage",
        "compaction_message",
      );
    },
  });

  return [compactionSummaryVariant];
}

export function compactionMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const compaction = defineMapping<PiEnvelope>({
    match: { type: "compaction" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const summary = stringValue(record.summary);
      if (summary === undefined) return [];
      const tokensBefore = numericValue(record.tokensBefore);
      const piMeta: Record<string, unknown> = {};
      if (record.firstKeptEntryId !== undefined) piMeta.firstKeptEntryId = record.firstKeptEntryId;
      if (record.details !== undefined) piMeta.details = record.details;
      if (record.fromHook !== undefined) piMeta.fromHook = record.fromHook;
      return emitCompaction(
        ctx,
        record,
        summary,
        tokensBefore,
        "compaction",
        "compaction_envelope",
        piMeta,
      );
    },
  });

  return [compaction];
}
