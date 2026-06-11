import { Buffer } from "node:buffer";
import type { Entry } from "@agent-trail/types";
import { enforceSourceRawSize, redactValue } from "../../source-raw.ts";
import {
  isNonEmptyString,
  isTaskPlanStatus,
  normalizeTaskPlanContent,
  type TaskPlanItem,
  taskPlanItemId,
} from "../../task-plan.ts";
import { AGENT_NAME } from "../parser.ts";
import { isObject, sanitizeSourceRaw, stringValue, timestampToIso } from "../source.ts";

export type Raw = Record<string, unknown>;
export type UserQueryOption = { id?: string; label: string; description?: string };

export const RAW_TYPE = "dev.codex.raw_type";

export function payloadOf(record: Raw): Raw {
  return isObject(record.payload) ? record.payload : {};
}

function elidedArrayMarker(value: unknown[]): Record<string, unknown> {
  return {
    elided: true,
    size_bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
    item_count: value.length,
  };
}

export function compactedSourceRaw(record: Raw): Raw {
  const payload = payloadOf(record);
  const replacementHistory = payload.replacement_history;
  if (!Array.isArray(replacementHistory)) return record;
  return {
    ...record,
    payload: {
      ...payload,
      replacement_history: elidedArrayMarker(replacementHistory),
    },
  };
}

export function emittable(record: Raw): boolean {
  return timestampToIso(record.timestamp) !== undefined;
}

export function source(originalType: string, raw?: Raw, synthesized?: boolean): Entry["source"] {
  const safeRaw = raw !== undefined ? sanitizeSourceRaw(raw) : undefined;
  return {
    agent: AGENT_NAME,
    original_type: originalType,
    ...(safeRaw !== undefined ? { raw: safeRaw } : {}),
    ...(synthesized === true ? { synthesized: true } : {}),
  };
}

export function meta(rawType: string, callId?: string): Record<string, unknown> {
  const normalizedCallId = nonEmptyCallId(callId);
  return {
    ...(normalizedCallId !== undefined ? { linker: { call_id: normalizedCallId } } : {}),
    [RAW_TYPE]: rawType,
  };
}

export function taskPlanItemsFromUpdatePlan(
  args: Record<string, unknown>,
): TaskPlanItem[] | undefined {
  if (!Array.isArray(args.plan)) return undefined;
  const items: TaskPlanItem[] = [];
  const occurrenceByContent = new Map<string, number>();
  for (const rawItem of args.plan) {
    if (!isObject(rawItem)) return undefined;
    const content = stringValue(rawItem.step);
    const status = rawItem.status;
    if (content === undefined || !isTaskPlanStatus(status)) return undefined;
    const rawId = stringValue(rawItem.id);
    const itemId = rawId !== undefined && rawId.trim().length > 0 ? rawId : undefined;
    const normalized = normalizeTaskPlanContent(content);
    const occurrence = occurrenceByContent.get(normalized) ?? 0;
    occurrenceByContent.set(normalized, occurrence + 1);
    items.push({
      id: taskPlanItemId(itemId, occurrence, content),
      content,
      status,
    });
  }
  return items;
}

export function diagnosticSourcePayload(payload: Raw): Raw {
  return enforceSourceRawSize(redactValue(payload)).value as Raw;
}

export function nonEmptyCallId(value: unknown): string | undefined {
  const callId = stringValue(value);
  return isNonEmptyString(callId) ? callId : undefined;
}
