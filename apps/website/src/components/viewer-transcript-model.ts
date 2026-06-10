import type { ViewerEvent } from "../gist-viewer.ts";

export type EventFilter = "agent" | "thinking" | "tool" | "user";
export type ActiveFilters = Record<EventFilter, boolean>;

export type TranscriptItem =
  | { kind: "agent"; event: ViewerEvent }
  | ToolTranscriptItem
  | { kind: "tool_group"; items: ToolTranscriptItem[] }
  | { kind: "user"; event: ViewerEvent };

export type ToolTranscriptItem = { kind: "tool"; call?: ViewerEvent; result?: ViewerEvent };

type UngroupedTranscriptItem = Exclude<TranscriptItem, { kind: "tool_group" }>;
type TranscriptBuildItem = UngroupedTranscriptItem | { kind: "separator" };

export const FILTERS: { filter: EventFilter; label: string; shortLabel: string }[] = [
  { filter: "user", label: "User messages", shortLabel: "U" },
  { filter: "agent", label: "Agent response messages", shortLabel: "A" },
  { filter: "thinking", label: "Agent thinking messages", shortLabel: "Th" },
  { filter: "tool", label: "Tool calls", shortLabel: "T" },
];

export const DEFAULT_FILTERS: ActiveFilters = {
  agent: true,
  thinking: true,
  tool: true,
  user: true,
};

export function buildTranscriptItemsForViewer(
  events: ViewerEvent[],
  activeFilters: ActiveFilters,
): TranscriptItem[] {
  return filterTranscriptItems(groupTranscriptItems(events), activeFilters);
}

function filterTranscriptItems(
  items: TranscriptItem[],
  activeFilters: ActiveFilters,
): TranscriptItem[] {
  return items.filter((item) => {
    if (item.kind === "tool" || item.kind === "tool_group") return activeFilters.tool;
    return activeFilters[filterForEvent(item.event)];
  });
}

function filterForEvent(event: ViewerEvent): EventFilter {
  if (event.kind === "tool_call" || event.kind === "tool_result") return "tool";
  if (event.kind === "agent" && isThinkingEvent(event)) return "thinking";
  if (event.kind === "agent") return "agent";
  return "user";
}

function groupTranscriptItems(events: ViewerEvent[]): TranscriptItem[] {
  const resultByCallId = new Map<string, ViewerEvent>();
  const consumedResultIds = new Set<string>();

  for (const event of events) {
    if (event.kind !== "tool_result") continue;
    const callId = event.meta.find((item) => item.label === "for")?.value;
    if (callId === undefined) continue;
    resultByCallId.set(callId, event);
  }

  const items: TranscriptBuildItem[] = [];
  for (const event of events) {
    if (event.kind === "user") {
      items.push({ kind: "user", event });
      continue;
    }
    if (event.kind === "agent") {
      items.push({ kind: "agent", event });
      continue;
    }
    if (event.kind === "tool_call") {
      const result = event.id === null ? undefined : resultByCallId.get(event.id);
      if (result?.id !== null && result?.id !== undefined) consumedResultIds.add(result.id);
      items.push({ kind: "tool", call: event, result });
      continue;
    }
    if (event.kind === "tool_result") {
      if (event.id !== null && consumedResultIds.has(event.id)) continue;
      items.push({ kind: "tool", result: event });
      continue;
    }
    items.push({ kind: "separator" });
  }
  return groupConsecutiveToolItems(items);
}

function groupConsecutiveToolItems(items: TranscriptBuildItem[]): TranscriptItem[] {
  const grouped: TranscriptItem[] = [];
  let pendingTools: ToolTranscriptItem[] = [];

  const flushTools = () => {
    const firstTool = pendingTools[0];
    if (pendingTools.length === 1 && firstTool !== undefined) {
      grouped.push(firstTool);
    } else if (pendingTools.length > 1) {
      grouped.push({ kind: "tool_group", items: pendingTools });
    }
    pendingTools = [];
  };

  for (const item of items) {
    if (item.kind === "tool") {
      pendingTools.push(item);
      continue;
    }
    flushTools();
    if (item.kind !== "separator") grouped.push(item);
  }
  flushTools();
  return grouped;
}

export function itemDomId(item: TranscriptItem): string {
  if (item.kind === "tool_group") {
    const firstItem = item.items[0];
    return firstItem === undefined ? "event-unknown" : itemDomId(firstItem);
  }
  const event = item.kind === "tool" ? (item.call ?? item.result) : item.event;
  return `event-${event?.line ?? "unknown"}`;
}

export function itemKey(item: TranscriptItem, index: number): string {
  if (item.kind === "tool_group") return `tool_group:${itemDomId(item)}:${item.items.length}`;
  const event = item.kind === "tool" ? (item.call ?? item.result) : item.event;
  return `${item.kind}:${event?.line ?? index}:${event?.id ?? index}`;
}

export function itemLabel(item: TranscriptItem): string {
  if (item.kind === "tool_group") return "Tools";
  if (item.kind === "tool") return "Tool";
  if (item.kind === "agent" && isThinkingEvent(item.event)) return "Think";
  return item.kind;
}

export function itemPreview(item: TranscriptItem): string {
  if (item.kind === "tool_group") return `${item.items.length} grouped tool calls...`;
  if (item.kind === "tool") {
    const primary = item.call ?? item.result;
    return truncatePreview(`${primary?.title ?? "Tool event"} ${primary?.body ?? ""}`);
  }
  return truncatePreview(item.event.body ?? item.event.title);
}

export function toolGroupTimestamp(
  item: Extract<TranscriptItem, { kind: "tool_group" }>,
): string | null {
  const firstItem = item.items[0];
  return firstItem === undefined ? null : ((firstItem.call ?? firstItem.result)?.ts ?? null);
}

export function toolRuleLabel(event: ViewerEvent): string {
  return event.title.replace(/^Tool call:\s*/i, "").replace(/^Tool result:\s*/i, "Tool_result");
}

function truncatePreview(value: string): string {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

export function agentRuleLabel(event: ViewerEvent): string {
  return isThinkingEvent(event) ? "Thought" : "Agent_reply";
}

export function isThinkingEvent(event: ViewerEvent): boolean {
  return event.type === "agent_thinking";
}
