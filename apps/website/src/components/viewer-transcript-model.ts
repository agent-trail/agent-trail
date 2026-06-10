import type { ViewerEvent } from "../gist-viewer.ts";

export type EventFilter = "agent" | "thinking" | "tool" | "user";
export type ActiveFilters = Record<EventFilter, boolean>;

export type TranscriptItem =
  | { kind: "agent"; event: ViewerEvent }
  | ToolTranscriptItem
  | { kind: "tool_group"; items: ToolTranscriptItem[] }
  | { kind: "user"; event: ViewerEvent };

export type ToolTranscriptItem = {
  abort?: ViewerEvent;
  call?: ViewerEvent;
  kind: "tool";
  result?: ViewerEvent;
};

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
  if (event.kind === "tool_aborted" || event.kind === "tool_call" || event.kind === "tool_result") {
    return "tool";
  }
  if (event.kind === "agent" && isThinkingEvent(event)) return "thinking";
  if (event.kind === "agent") return "agent";
  if (event.kind === "user") return "user";
  return "agent";
}

function groupTranscriptItems(events: ViewerEvent[]): TranscriptItem[] {
  const pairedCallIdByEventIndex = pairToolLifecycleEvents(events);
  const currentRunCallItems = new Map<string, ToolTranscriptItem>();
  const items: TranscriptBuildItem[] = [];

  const clearCurrentToolRun = () => {
    currentRunCallItems.clear();
  };

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex] as ViewerEvent;
    if (events[eventIndex - 1]?.sessionIndex !== event.sessionIndex) {
      clearCurrentToolRun();
      items.push({ kind: "separator" });
    }
    if (event.kind === "user") {
      clearCurrentToolRun();
      items.push({ kind: "user", event });
      continue;
    }
    if (event.kind === "agent") {
      clearCurrentToolRun();
      items.push({ kind: "agent", event });
      continue;
    }
    if (event.kind === "tool_call") {
      const item: ToolTranscriptItem = { kind: "tool", call: event };
      items.push(item);
      if (event.id !== null) currentRunCallItems.set(event.id, item);
      continue;
    }
    if (event.kind === "tool_result") {
      const pairedCallId = pairedCallIdByEventIndex.get(eventIndex);
      const callItem =
        pairedCallId === undefined ? undefined : currentRunCallItems.get(pairedCallId);
      if (callItem !== undefined && callItem.result === undefined) {
        callItem.result = event;
        continue;
      }
      items.push({ kind: "tool", result: event });
      continue;
    }
    if (event.kind === "tool_aborted") {
      const pairedCallId = pairedCallIdByEventIndex.get(eventIndex);
      const callItem =
        pairedCallId === undefined ? undefined : currentRunCallItems.get(pairedCallId);
      if (callItem !== undefined && callItem.abort === undefined) {
        callItem.abort = event;
        continue;
      }
      items.push({ kind: "tool", abort: event });
      continue;
    }
    clearCurrentToolRun();
    items.push({ kind: "separator" });
  }
  return groupConsecutiveToolItems(items);
}

function pairToolLifecycleEvents(events: ViewerEvent[]): Map<number, string> {
  const pairedCallIdByEventIndex = new Map<number, string>();
  let sessionStart = 0;

  while (sessionStart < events.length) {
    const sessionIndex = events[sessionStart]?.sessionIndex;
    let sessionEnd = sessionStart + 1;
    while (sessionEnd < events.length && events[sessionEnd]?.sessionIndex === sessionIndex) {
      sessionEnd += 1;
    }
    pairToolLifecycleEventsInRange(events, sessionStart, sessionEnd, pairedCallIdByEventIndex);
    sessionStart = sessionEnd;
  }

  return pairedCallIdByEventIndex;
}

function pairToolLifecycleEventsInRange(
  events: ViewerEvent[],
  start: number,
  end: number,
  pairedCallIdByEventIndex: Map<number, string>,
): void {
  type Call = {
    id: string;
    matched: boolean;
    semanticCallId?: string;
  };
  type Result = {
    callIndex: number;
    canExplicitMatch: boolean;
    canFallback: boolean;
    eventIndex: number;
    forId?: string;
    matched: boolean;
    semanticCallId?: string;
  };

  const calls: Call[] = [];
  const callById = new Map<string, Call>();
  const results: Result[] = [];

  for (let eventIndex = start; eventIndex < end; eventIndex += 1) {
    const event = events[eventIndex];
    if (event === undefined) continue;
    if (event.kind === "tool_call") {
      if (event.id === null) continue;
      const call = {
        id: event.id,
        matched: false,
        semanticCallId: event.tool?.semanticCallId,
      };
      calls.push(call);
      callById.set(call.id, call);
      continue;
    }
    if (event.kind !== "tool_result" && event.kind !== "tool_aborted") continue;
    results.push({
      callIndex: calls.length,
      canExplicitMatch: event.kind === "tool_result" || event.tool?.scope === "tool_call",
      canFallback: event.kind === "tool_result",
      eventIndex,
      forId: event.tool?.forId,
      matched: false,
      semanticCallId: event.kind === "tool_result" ? event.tool?.semanticCallId : undefined,
    });
  }

  for (const result of results) {
    if (!result.canExplicitMatch || result.forId === undefined) continue;
    const call = callById.get(result.forId);
    if (call === undefined) continue;
    result.matched = true;
    pairedCallIdByEventIndex.set(result.eventIndex, call.id);
    if (!call.matched) call.matched = true;
  }

  const callsBySemanticCallId = new Map<string, Call[]>();
  for (const call of calls) {
    if (call.matched || call.semanticCallId === undefined) continue;
    const bucket = callsBySemanticCallId.get(call.semanticCallId);
    if (bucket === undefined) {
      callsBySemanticCallId.set(call.semanticCallId, [call]);
    } else {
      bucket.push(call);
    }
  }

  for (const result of results) {
    if (result.matched || !result.canFallback || result.semanticCallId === undefined) continue;
    const bucket = callsBySemanticCallId.get(result.semanticCallId);
    if (bucket === undefined || bucket.length === 0) continue;
    const call = bucket.shift();
    if (call === undefined) continue;
    call.matched = true;
    result.matched = true;
    pairedCallIdByEventIndex.set(result.eventIndex, call.id);
  }

  for (const result of results) {
    if (result.matched || !result.canFallback) continue;
    for (let index = result.callIndex - 1; index >= 0; index -= 1) {
      const call = calls[index];
      if (call === undefined || call.matched) continue;
      call.matched = true;
      result.matched = true;
      pairedCallIdByEventIndex.set(result.eventIndex, call.id);
      break;
    }
  }
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
  const event = item.kind === "tool" ? (item.call ?? item.result ?? item.abort) : item.event;
  return `event-${event?.line ?? "unknown"}`;
}

export function itemKey(item: TranscriptItem, index: number): string {
  if (item.kind === "tool_group") return `tool_group:${itemDomId(item)}:${item.items.length}`;
  const event = item.kind === "tool" ? (item.call ?? item.result ?? item.abort) : item.event;
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
    const primary = item.call ?? item.result ?? item.abort;
    return truncatePreview(`${primary?.title ?? "Tool event"} ${primary?.body ?? ""}`);
  }
  return truncatePreview(item.event.body ?? item.event.title);
}

export function toolGroupTimestamp(
  item: Extract<TranscriptItem, { kind: "tool_group" }>,
): string | null {
  const firstItem = item.items[0];
  return firstItem === undefined
    ? null
    : ((firstItem.call ?? firstItem.result ?? firstItem.abort)?.ts ?? null);
}

export function toolRuleLabel(event: ViewerEvent): string {
  return event.title
    .replace(/^Tool call:\s*/i, "")
    .replace(/^Tool result:\s*/i, "Tool_result")
    .replace(/^Tool aborted:\s*/i, "Tool_aborted: ");
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
