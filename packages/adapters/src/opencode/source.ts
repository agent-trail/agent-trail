import { readFile } from "node:fs/promises";
import type { Entry } from "@agent-trail/types";
import { enforceSourceRawSize, redactValue } from "../source-raw.ts";

export const SOURCE_SCHEMA_VERSION = "v1";

export type Raw = Record<string, unknown>;

export type OpenCodeSessionSummary = {
  id: string;
  cwd: string;
  modifiedAt: string;
  path: string;
  version?: string;
};

export type OpenCodeMessage = Raw & {
  id: string;
  role?: string;
  time?: Raw;
};

export type OpenCodePart = Raw & {
  id: string;
  type?: string;
  messageID?: string;
  message_id?: string;
  time?: Raw;
};

export type OpenCodeTodo = Raw & {
  content?: string;
  status?: string;
  position?: number;
  time?: Raw;
};

export type LoadedSession = {
  session: Raw;
  project?: Raw;
  messages: OpenCodeMessage[];
  partsByMessage: Map<string, OpenCodePart[]>;
  todos: OpenCodeTodo[];
  sessionMessages: Raw[];
  permissions: Raw[];
};

export function isObject(value: unknown): value is Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function objectValue(value: unknown): Raw | undefined {
  return isObject(value) ? value : undefined;
}

export function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function timestampToIso(value: unknown): string | undefined {
  try {
    const n = numberValue(value);
    if (n !== undefined) {
      const date = new Date(n);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    const s = stringValue(value);
    if (s !== undefined) {
      const trimmed = s.trim();
      if (trimmed.length === 0) return undefined;
      const ms = Number(trimmed);
      if (Number.isFinite(ms)) {
        const date = new Date(ms);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
      }
      const parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed)) {
        const date = new Date(parsed);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function readJsonFile(path: string): Promise<Raw | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parsedJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parsedJsonObject(text: unknown): Raw {
  if (isObject(text)) return text;
  if (typeof text !== "string") return {};
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizedSourceRaw(raw: Raw, rawType: string): Raw {
  const redacted = redactValue(raw) as Raw;
  if (rawType.startsWith("part.") || rawType.startsWith("tool.")) {
    return { type: "part", part_type: stringValue(raw.type) ?? "tool", data: redacted };
  }
  if (rawType.startsWith("session_message.")) {
    return { type: "session_message", event_type: stringValue(raw.type), data: redacted };
  }
  if (rawType.startsWith("session.")) return { type: "session", data: redacted };
  if (rawType.startsWith("project.")) return { type: "project", data: redacted };
  if (rawType === "todo") return { type: "todo", data: redacted };
  if (rawType === "permission") return { type: "permission", data: redacted };
  if (rawType === "event") return { type: "event", data: redacted };
  return { type: rawType, data: redacted };
}

export function sourceFor(
  raw: Raw,
  rawType: string,
  schemaVersion: string | undefined,
): Entry["source"] {
  const normalized = normalizedSourceRaw(raw, rawType);
  return {
    agent: "opencode",
    original_type: rawType,
    ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
    raw: enforceSourceRawSize(normalized).value as Raw,
  };
}

export function metaFor(rawType: string): Entry["meta"] {
  return { "dev.opencode.raw_type": rawType };
}

export function sourceId(raw: Raw, fallback: string): string {
  return stringValue(raw.id) ?? fallback;
}

export function partTimestamp(part: Raw, message?: Raw): string {
  const time = objectValue(part.time);
  const messageTime = objectValue(message?.time);
  return (
    timestampToIso(time?.created) ??
    timestampToIso(time?.updated) ??
    timestampToIso(part.time_created) ??
    timestampToIso(part.time_updated) ??
    timestampToIso(messageTime?.created) ??
    timestampToIso(messageTime?.updated) ??
    timestampToIso(message?.time_created) ??
    timestampToIso(message?.time_updated) ??
    new Date(0).toISOString()
  );
}

export function modelName(value: unknown): string | undefined {
  const obj = objectValue(value);
  if (obj !== undefined) {
    const id = stringValue(obj.id) ?? stringValue(obj.modelID);
    const provider = stringValue(obj.providerID) ?? stringValue(obj.provider);
    if (id !== undefined && provider !== undefined) return `${provider}/${id}`;
    return id;
  }
  return stringValue(value);
}
