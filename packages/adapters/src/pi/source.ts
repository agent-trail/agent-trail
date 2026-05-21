export type PiBlock = Record<string, unknown> & { type?: string };

export type PiMessage = {
  role?: string;
  content?: unknown;
  provider?: string;
  model?: string;
  usage?: unknown;
  stopReason?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export type PiEnvelope = {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  sessionId?: string;
  version?: number | string;
  cwd?: string;
  message?: PiMessage;
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

export function versionString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}
