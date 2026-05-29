import { coerceInt, isObject, jsonObjectValue, stringValue } from "@agent-trail/adapter-kit";

// Re-export shared primitives under the adapter's helper barrel. maybeNumber is
// the strict coerceInt; isObject/stringValue/jsonObjectValue are shared verbatim.
export { coerceInt as maybeNumber, isObject, jsonObjectValue, stringValue };

export type CcEnvelope = {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  timestamp?: string;
  sessionId?: string;
  version?: string;
  cwd?: string;
  summary?: string;
  leafUuid?: string;
  operation?: string;
  content?: unknown;
  data?: unknown;
  toolUseID?: string;
  toolUseId?: string;
  tool_use_id?: string;
  parentToolUseID?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    stop_reason?: string;
    usage?: unknown;
  };
  [key: string]: unknown;
};

export type CcBlock = Record<string, unknown> & { type?: string };

export function isTracerEnvelope(envelope: CcEnvelope): boolean {
  if (envelope.type === "attachment") return false;
  if (envelope.type === "file-history-snapshot") return false;
  if (envelope.isSidechain === true) return false;
  if (envelope.isMeta === true) return false;
  return (
    envelope.type === "user" ||
    envelope.type === "assistant" ||
    envelope.type === "summary" ||
    envelope.type === "system" ||
    envelope.type === "progress" ||
    envelope.type === "queue-operation" ||
    envelope.type === "pr-link" ||
    envelope.type === "permission-mode"
  );
}

export function parseLines(text: string): CcEnvelope[] {
  const out: CcEnvelope[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) continue;
    out.push(JSON.parse(raw) as CcEnvelope);
  }
  return out;
}

export function asBlocks(content: unknown): CcBlock[] {
  return Array.isArray(content) ? content.filter(isObject) : [];
}

export function jsonString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

export function textFromToolResultContent(content: unknown): string {
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

// Claude Code engine emits these bracket markers verbatim; not user-authored.
export function isInterruptMarker(text: string): { reason: string } | undefined {
  const trimmed = text.trim();
  const match = /^\[Request interrupted by (.+)\]$/.exec(trimmed);
  if (match === null) return undefined;
  const reason = match[1];
  if (reason === undefined) return undefined;
  return { reason };
}

export function isContinuationPreamble(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("This session is") ||
    trimmed.startsWith("Here is the conversation so far") ||
    trimmed.startsWith("Here's the conversation so far")
  );
}
