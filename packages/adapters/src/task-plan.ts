import { createHash } from "node:crypto";
import type { Entry } from "@agent-trail/types";

export type TaskPlanStatus = "pending" | "in_progress" | "completed" | "cancelled" | "blocked";

export type TaskPlanItem = {
  id: string;
  content: string;
  status: TaskPlanStatus;
  active_form?: string;
};

type AddedDelta = {
  kind: "added";
  item_id: string;
  to_content: string;
  to_status: TaskPlanStatus;
  to_active_form?: string;
};

type RemovedDelta = {
  kind: "removed";
  item_id: string;
  from_content: string;
  from_status: TaskPlanStatus;
  from_active_form?: string;
};

type StatusChangedDelta = {
  kind: "status_changed";
  item_id: string;
  from_status: TaskPlanStatus;
  to_status: TaskPlanStatus;
};

type ContentChangedDelta = {
  kind: "content_changed";
  item_id: string;
  from_content: string;
  to_content: string;
};

export type TaskPlanDelta = AddedDelta | RemovedDelta | StatusChangedDelta | ContentChangedDelta;

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

export function synthesizeTaskPlanItemId(position: number, content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const digest = createHash("sha256")
    .update(`${position}\0${normalized}`)
    .digest("hex")
    .slice(0, 16);
  return `item-${digest}`;
}

export function taskPlanItemId(rawId: unknown, position: number, content: string): string {
  if (typeof rawId === "string" && rawId.length > 0) return rawId;
  return synthesizeTaskPlanItemId(position, content);
}

export function withTaskPlanDeltas(entries: Entry[]): Entry[] {
  let previous = new Map<string, TaskPlanItem>();
  return entries.map((entry) => {
    if (entry.type !== "task_plan_update") return entry;
    const payload = entry.payload as { items?: unknown; deltas?: unknown };
    if (!Array.isArray(payload.items)) return entry;
    const items = payload.items.filter(isTaskPlanItem);
    if (items.length !== payload.items.length) return entry;
    const current = new Map(items.map((item) => [item.id, item]));
    const deltas = taskPlanDeltas(previous, current);
    previous = current;
    return {
      ...entry,
      payload: { ...payload, deltas },
    } as Entry;
  });
}

export function dropTaskPlanAckResults(entries: Entry[]): Entry[] {
  const taskPlanCallIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "task_plan_update") continue;
    const callId = entry.semantic?.call_id;
    if (callId !== undefined) taskPlanCallIds.add(callId);
  }
  if (taskPlanCallIds.size === 0) return entries;

  const droppedParentById = new Map<string, string | null>();
  const kept: Entry[] = [];
  for (const entry of entries) {
    if (entry.type === "tool_result" && taskPlanCallIds.has(entry.semantic?.call_id ?? "")) {
      droppedParentById.set(entry.id, entry.parent_id ?? null);
      continue;
    }
    kept.push(entry);
  }

  if (droppedParentById.size === 0) return entries;
  return kept.map((entry) => {
    const parentId = reparentThroughDropped(entry.parent_id, droppedParentById);
    if (parentId === entry.parent_id) return entry;
    return { ...entry, parent_id: parentId } as Entry;
  });
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
  const item = value as TaskPlanItem;
  return (
    typeof item.id === "string" &&
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
