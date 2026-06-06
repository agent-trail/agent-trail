import { open } from "node:fs/promises";
import { DISCOVERY_CONCURRENCY_LIMIT, mapConcurrent } from "@agent-trail/adapters";
import { objectPath } from "@agent-trail/store";
import type { Row } from "./list-model.ts";

type BrowserMetadata = {
  agent: string | null;
  cwd: string | null;
};

export async function enrichBrowserRows(storeRoot: string, rows: Row[]): Promise<Row[]> {
  return await mapConcurrent(rows, DISCOVERY_CONCURRENCY_LIMIT, async (row) => {
    const [displayName, metadata] = await Promise.all([
      browserDisplayName(storeRoot, row),
      browserMetadata(storeRoot, row),
    ]);
    return {
      ...row,
      agent: row.agent ?? metadata.agent,
      cwd: row.cwd ?? metadata.cwd,
      display_name: displayName,
    };
  });
}

async function browserDisplayName(storeRoot: string, row: Row): Promise<string | null> {
  if (row.content_hash !== null) {
    const registeredName = await displayNameFromPath(objectPath(storeRoot, row.content_hash), true);
    if (registeredName !== null) return registeredName;
  }
  if (row.source_path === null) return null;
  return await displayNameFromPath(row.source_path, false);
}

async function displayNameFromPath(path: string, preferTrailName: boolean): Promise<string | null> {
  let head: string;
  try {
    head = await readHead(path);
  } catch {
    return null;
  }
  return extractDisplayNameFromHead(head, preferTrailName);
}

async function browserMetadata(storeRoot: string, row: Row): Promise<BrowserMetadata> {
  const paths = [
    row.content_hash === null ? null : objectPath(storeRoot, row.content_hash),
    row.source_path,
  ].filter((value): value is string => value !== null);
  let inferred: BrowserMetadata = {
    agent: inferAgentFromPath(row.registered_source_path),
    cwd: null,
  };
  for (const path of paths) {
    const fallbackAgent = inferAgentFromPath(path);
    try {
      const metadata = extractMetadataFromHead(await readHead(path));
      inferred = {
        agent: inferred.agent ?? metadata.agent ?? fallbackAgent,
        cwd: inferred.cwd ?? metadata.cwd,
      };
    } catch {
      inferred = { ...inferred, agent: inferred.agent ?? fallbackAgent };
    }
    if (inferred.agent !== null && inferred.cwd !== null) return inferred;
  }
  return inferred;
}

function extractMetadataFromHead(head: string): BrowserMetadata {
  const metadata: BrowserMetadata = { agent: null, cwd: null };
  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isPlainObject(record)) continue;
    metadata.agent ??= extractAgentName(record) ?? extractSourceAgentName(record);
    metadata.cwd ??= extractCwd(record);
    if (metadata.agent !== null && metadata.cwd !== null) return metadata;
  }
  return metadata;
}

function extractDisplayNameFromHead(head: string, preferTrailName: boolean): string | null {
  let firstMessage: string | null = null;
  for (const line of head.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const name = trailName(record);
    if (preferTrailName && name !== null) return name;
    firstMessage ??= firstUserMessage(record);
    if (!preferTrailName && firstMessage !== null) return firstMessage;
  }
  return firstMessage;
}

function trailName(record: unknown): string | null {
  if (!isPlainObject(record)) return null;
  if (record.type !== "session_metadata_update") return null;
  const payload = record.payload;
  if (!isPlainObject(payload) || payload.field !== "name" || typeof payload.value !== "string") {
    return null;
  }
  return cleanDisplayText(payload.value);
}

function firstUserMessage(record: unknown): string | null {
  if (!isPlainObject(record)) return null;
  if (record.type === "user_message") {
    const payload = record.payload;
    return isPlainObject(payload) && typeof payload.text === "string"
      ? cleanDisplayText(payload.text)
      : null;
  }
  if (record.type === "event_msg") {
    const payload = record.payload;
    return isPlainObject(payload) &&
      payload.type === "user_message" &&
      typeof payload.message === "string"
      ? cleanDisplayText(payload.message)
      : null;
  }
  const message = record.message;
  if (isPlainObject(message) && message.role === "user") {
    if (typeof message.content === "string") return cleanDisplayText(message.content);
    if (Array.isArray(message.content)) {
      const text = message.content
        .map((block) =>
          isPlainObject(block) && typeof block.text === "string" ? block.text : undefined,
        )
        .find((value): value is string => value !== undefined);
      if (text !== undefined) return cleanDisplayText(text);
    }
  }
  return null;
}

function cleanDisplayText(value: string): string | null {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length === 0 ? null : clean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAgentName(header: Record<string, unknown> | null): string | null {
  if (header === null) return null;
  const agent = header.agent;
  if (typeof agent !== "object" || agent === null || Array.isArray(agent)) return null;
  const name = (agent as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

function extractSourceAgentName(record: Record<string, unknown>): string | null {
  const source = record.source;
  if (!isPlainObject(source)) return null;
  const agent = source.agent;
  return typeof agent === "string" ? agent : null;
}

function extractCwd(header: Record<string, unknown> | null): string | null {
  return header !== null && typeof header.cwd === "string" ? header.cwd : null;
}

function inferAgentFromPath(path: string | null): string | null {
  if (path === null) return null;
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("/.codex/sessions/")) return "codex";
  if (normalized.includes("/.claude/projects/")) return "claude-code";
  if (normalized.includes("/.opencode/")) return "opencode";
  return null;
}

async function readHead(path: string): Promise<string> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, "r");
    const buf = new Uint8Array(SEARCH_HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, buf.byteLength, 0);
    return new TextDecoder("utf-8").decode(buf.subarray(0, bytesRead));
  } finally {
    if (handle !== null) {
      await handle.close().catch(() => {});
    }
  }
}

const SEARCH_HEAD_BYTES = 65_536;
