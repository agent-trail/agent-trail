import { createHash } from "node:crypto";
import type { Entry, TaskPlanDelta, TaskPlanItem, TaskPlanStatus } from "@agent-trail/types";

export type { TaskPlanDelta, TaskPlanItem, TaskPlanStatus } from "@agent-trail/types";

const TASK_PLAN_STATUSES = new Set<TaskPlanStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "blocked",
]);

export function isTaskPlanStatus(value: unknown): value is TaskPlanStatus {
  return typeof value === "string" && TASK_PLAN_STATUSES.has(value as TaskPlanStatus);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeTaskPlanContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function synthesizeTaskPlanItemId(occurrence: number, content: string): string {
  const normalized = normalizeTaskPlanContent(content);
  const digest = createHash("sha256")
    .update(`${normalized}\0${occurrence}`)
    .digest("hex")
    .slice(0, 16);
  return `item-${digest}`;
}

export function taskPlanItemId(rawId: unknown, occurrence: number, content: string): string {
  if (isNonEmptyString(rawId)) return rawId;
  return synthesizeTaskPlanItemId(occurrence, content);
}

export function withTaskPlanDeltas(entries: Entry[]): Entry[] {
  let previous = new Map<string, TaskPlanItem>();
  return entries.map((entry) => {
    if (entry.type !== "task_plan_update") return entry;
    const payload = entry.payload;
    if (payload === undefined) return entry;
    const rawItems = payload.items;
    if (!Array.isArray(rawItems)) return entry;
    const items = rawItems.filter(isTaskPlanItem);
    if (items.length !== rawItems.length) return entry;
    const current = new Map(items.map((item) => [item.id, item]));
    const deltas = taskPlanDeltas(previous, current);
    previous = current;
    return {
      ...entry,
      payload: { ...payload, deltas },
    } as Entry;
  });
}

type DropTaskPlanAckResultsOptions = {
  sourceGroupKey?: (entry: Entry) => string | undefined;
};

const CODEX_UPDATE_PLAN_ACK_OUTPUTS = new Set(["", "{}", "null", "Plan updated"]);
const CLAUDE_TODO_WRITE_ACK_OUTPUTS = new Set([
  "",
  "ok",
  "Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable",
]);

export function dropTaskPlanAckResults(
  entries: Entry[],
  options: DropTaskPlanAckResultsOptions = {},
): Entry[] {
  const taskPlanCallIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "task_plan_update") continue;
    const callId = entry.semantic?.call_id;
    if (isNonEmptyString(callId)) taskPlanCallIds.add(callId);
  }
  if (taskPlanCallIds.size === 0) return entries;

  const droppedParentById = new Map<string, string | null>();
  const droppedSourceEnvelopeByGroup = new Map<string, unknown>();
  const kept: Entry[] = [];
  for (const entry of entries) {
    if (isDroppableTaskPlanAckResult(entry, taskPlanCallIds)) {
      droppedParentById.set(entry.id, entry.parent_id ?? null);
      const groupKey = options.sourceGroupKey?.(entry);
      const raw = sourceRaw(entry);
      if (groupKey !== undefined && raw !== undefined && "envelope" in raw) {
        droppedSourceEnvelopeByGroup.set(groupKey, raw.envelope);
      }
      continue;
    }
    kept.push(entry);
  }

  if (droppedParentById.size === 0) return entries;
  const reparented = kept.map((entry) => {
    const parentId = reparentThroughDropped(entry.parent_id, droppedParentById);
    if (parentId === entry.parent_id) return entry;
    return { ...entry, parent_id: parentId } as Entry;
  });
  return promoteDroppedSourceEnvelopes(
    reparented,
    droppedSourceEnvelopeByGroup,
    options.sourceGroupKey,
  );
}

function isDroppableTaskPlanAckResult(entry: Entry, taskPlanCallIds: Set<string>): boolean {
  if (entry.type !== "tool_result") return false;
  const callId = entry.semantic?.call_id;
  if (!isNonEmptyString(callId) || !taskPlanCallIds.has(callId)) return false;

  const payload = entry.payload as { for_id?: unknown; ok?: unknown; output?: unknown };
  if (typeof payload.for_id === "string") return false;
  if (payload.ok === false) return false;
  const output = typeof payload.output === "string" ? payload.output.trim() : "";

  switch (entry.source?.original_type) {
    case "response_item.function_call_output":
      return CODEX_UPDATE_PLAN_ACK_OUTPUTS.has(output);
    case "tool_result":
      return CLAUDE_TODO_WRITE_ACK_OUTPUTS.has(output);
    default:
      return false;
  }
}

function promoteDroppedSourceEnvelopes(
  entries: Entry[],
  envelopeByGroup: Map<string, unknown>,
  sourceGroupKey: DropTaskPlanAckResultsOptions["sourceGroupKey"],
): Entry[] {
  if (sourceGroupKey === undefined || envelopeByGroup.size === 0) return entries;
  const promoted = new Set<string>();
  return entries.map((entry) => {
    const groupKey = sourceGroupKey(entry);
    if (groupKey === undefined || promoted.has(groupKey)) return entry;
    const envelope = envelopeByGroup.get(groupKey);
    if (envelope === undefined) return entry;
    const raw = sourceRaw(entry);
    if (raw === undefined || "envelope" in raw || !("envelope_ref" in raw)) return entry;
    const { envelope_ref: _drop, ...rest } = raw;
    promoted.add(groupKey);
    return {
      ...entry,
      source: {
        ...entry.source,
        raw: {
          envelope,
          ...rest,
        },
      },
    } as Entry;
  });
}

function sourceRaw(entry: Entry): Record<string, unknown> | undefined {
  const raw = entry.source?.raw;
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
}

function taskPlanDeltas(
  previous: Map<string, TaskPlanItem>,
  current: Map<string, TaskPlanItem>,
): TaskPlanDelta[] {
  const deltas: TaskPlanDelta[] = [];

  for (const item of current.values()) {
    const prev = previous.get(item.id);
    if (prev === undefined) {
      deltas.push({
        kind: "added",
        item_id: item.id,
        to_content: item.content,
        to_status: item.status,
        ...(item.active_form !== undefined ? { to_active_form: item.active_form } : {}),
      });
      continue;
    }
    if (prev.status !== item.status) {
      deltas.push({
        kind: "status_changed",
        item_id: item.id,
        from_status: prev.status,
        to_status: item.status,
      });
    }
    if (prev.content !== item.content) {
      deltas.push({
        kind: "content_changed",
        item_id: item.id,
        from_content: prev.content,
        to_content: item.content,
      });
    }
  }

  for (const item of previous.values()) {
    if (current.has(item.id)) continue;
    deltas.push({
      kind: "removed",
      item_id: item.id,
      from_content: item.content,
      from_status: item.status,
      ...(item.active_form !== undefined ? { from_active_form: item.active_form } : {}),
    });
  }

  return deltas;
}

function isTaskPlanItem(value: unknown): value is TaskPlanItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isNonEmptyString(item.id) &&
    typeof item.content === "string" &&
    isTaskPlanStatus(item.status) &&
    (item.active_form === undefined || typeof item.active_form === "string")
  );
}

function reparentThroughDropped(
  parentId: Entry["parent_id"],
  droppedParentById: Map<string, string | null>,
): Entry["parent_id"] {
  let next = parentId;
  const seen = new Set<string>();
  while (typeof next === "string" && droppedParentById.has(next) && !seen.has(next)) {
    seen.add(next);
    next = droppedParentById.get(next) ?? null;
  }
  return next;
}
