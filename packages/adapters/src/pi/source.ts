export type PiBlock = Record<string, unknown> & { type?: string };

export type PiMessage = {
  role?: string;
  content?: unknown;
  provider?: string;
  model?: string;
  usage?: unknown;
  stopReason?: string;
  toolCallId?: string | number;
  toolName?: string;
  isError?: boolean;
};

export type PiEnvelope = {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string | number;
  sessionId?: string;
  version?: number | string;
  cwd?: string;
  message?: PiMessage;
  fromId?: string;
  summary?: string;
  details?: unknown;
  [key: string]: unknown;
};

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseLines(text: string): PiEnvelope[] {
  const out: PiEnvelope[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) continue;
    out.push(JSON.parse(raw) as PiEnvelope);
  }
  return out;
}

export function asBlocks(content: unknown): PiBlock[] {
  return Array.isArray(content) ? content.filter(isObject) : [];
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Numeric field coercion. Accept a number, or a numeric string (e.g., `"12000"`) — Pi top-level
// envelopes use numbers per pi-mono `coding-agent/src/core/session-manager.ts`, but lenient at the
// adapter boundary keeps polymorphic parsing consistent with timestampToIso().
export function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Tool-call id / tool-result toolCallId boundary coercion. Pi-ai types ToolCall.id as string,
// but a non-conforming source could emit a number. Defense-in-depth: stringify finite numbers so
// they never leak into semantic.call_id / tool_result.for_id as their raw type.
export function idValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function jsonObjectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

export function jsonString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter(isObject)
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("\n");
    return text.length > 0 ? text : JSON.stringify(content);
  }
  return jsonString(content);
}

// Polymorphic timestamp parser. Pi top-level envelopes use ISO strings, but pi-mono internal
// messages (BashExecutionMessage, CompactionSummaryMessage, BranchSummaryMessage in
// `packages/coding-agent/src/core/messages.ts`) carry Unix ms numbers. Accept either at the
// envelope boundary and emit a canonical ISO string downstream.
function msToIsoSafe(ms: number): string | undefined {
  // JS `Date` is valid for ±8,640,000,000,000,000 ms (~100M days). Anything beyond throws
  // RangeError on `.toISOString()`. Guard the conversion so one malformed envelope never aborts
  // parsing for an entire session.
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  try {
    return d.toISOString();
  } catch {
    return undefined;
  }
}

export function timestampToIso(value: unknown): string | undefined {
  if (typeof value === "string") {
    if (value.length === 0) return undefined;
    const parsedNum = Number(value);
    if (Number.isFinite(parsedNum) && /^\d+$/.test(value)) {
      return msToIsoSafe(parsedNum);
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return msToIsoSafe(value);
  }
  return undefined;
}

export function versionString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
