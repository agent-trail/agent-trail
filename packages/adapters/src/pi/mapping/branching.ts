import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { isObject, type PiEnvelope, stringValue } from "../source.ts";
import type { PiMappingContext } from "./context.ts";
import { type Meta, metaFor } from "./shared.ts";

function emitBranchSummary(
  ctx: PiMappingContext,
  record: PiEnvelope,
  summary: string,
  fromId: string,
  originalType: string,
  rawType: string,
  extras?: { details?: Record<string, unknown>; fromHook?: unknown },
): TrailEntryDraft[] {
  const extraMeta: Meta = {};
  if (extras?.details !== undefined) extraMeta["dev.pi.branch_details"] = extras.details;
  if (typeof extras?.fromHook === "boolean") extraMeta["dev.pi.branch_from_hook"] = extras.fromHook;
  return [
    {
      // abandoned_branch_id starts as the raw fromId; piParentResolution refines
      // it to the abandoned branch's root entry id (divergence walk).
      type: "branch_summary",
      payload: { abandoned_branch_id: fromId, summary },
      source: ctx.src(record, originalType),
      meta: metaFor(record, rawType, Object.keys(extraMeta).length > 0 ? extraMeta : undefined, {
        fromId,
      }),
    },
  ];
}

export function branchVariantMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const branchSummaryVariant = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "branchSummary" } },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const summary = stringValue(record.message?.summary);
      const fromId = stringValue(record.message?.fromId);
      if (summary === undefined || fromId === undefined) return [];
      return emitBranchSummary(
        ctx,
        record,
        summary,
        fromId,
        "branchSummaryMessage",
        "branch_summary_message",
      );
    },
  });

  return [branchSummaryVariant];
}

export function branchMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const branchSummary = defineMapping<PiEnvelope>({
    match: { type: "branch_summary" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
      const summary = stringValue(record.summary);
      const fromId = stringValue(record.fromId);
      if (summary === undefined || fromId === undefined) return [];
      const details = isObject(record.details) ? record.details : undefined;
      return emitBranchSummary(
        ctx,
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

  return [branchSummary];
}

export function branchStateMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const leaf = defineMapping<PiEnvelope>({
    match: { type: "leaf" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
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
          source: ctx.src(record, "leaf"),
          meta: metaFor(record, "leaf_envelope"),
        },
      ];
    },
  });

  const label = defineMapping<PiEnvelope>({
    match: { type: "label" },
    emit: (record) => {
      if (ctx.emittableTs(record) === null) return [];
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
          source: ctx.src(record, "label"),
          meta: metaFor(record, "label_envelope"),
        },
      ];
    },
  });

  return [leaf, label];
}
