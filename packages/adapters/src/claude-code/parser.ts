import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";

type CcEnvelope = {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  sessionId?: string;
  version?: string;
  cwd?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
  };
  [key: string]: unknown;
};

function isTracerEnvelope(envelope: CcEnvelope): boolean {
  if (envelope.type === "queue-operation") return false;
  if (envelope.type === "attachment") return false;
  if (envelope.isSidechain === true) return false;
  if (envelope.isMeta === true) return false;
  if (envelope.type !== "user" && envelope.type !== "assistant" && envelope.type !== "summary") {
    return false;
  }
  return true;
}

function parseLines(text: string): CcEnvelope[] {
  const out: CcEnvelope[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) continue;
    out.push(JSON.parse(raw) as CcEnvelope);
  }
  return out;
}

function buildHeader(envelopes: CcEnvelope[]): Header {
  const first = envelopes.find(isTracerEnvelope);
  if (first === undefined || first.sessionId === undefined || first.timestamp === undefined) {
    throw new Error("Claude Code session has no parseable records");
  }
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id: first.sessionId,
    ts: first.timestamp,
    agent: {
      name: "claude-code",
      ...(first.version !== undefined ? { version: first.version } : {}),
    },
  };
  if (first.cwd !== undefined) header.cwd = first.cwd;
  header.source = {
    agent: "claude-code",
    ...(first.version !== undefined ? { format_version: first.version } : {}),
  };
  return header;
}

function resolveParentId(
  startParentUuid: string | null | undefined,
  parentByUuid: Map<string, string | null>,
  emittedUuids: Set<string>,
): string | undefined {
  let cursor: string | null | undefined = startParentUuid;
  const guard = new Set<string>();
  while (typeof cursor === "string") {
    if (guard.has(cursor)) return undefined;
    guard.add(cursor);
    if (emittedUuids.has(cursor)) return cursor;
    cursor = parentByUuid.get(cursor) ?? undefined;
  }
  return undefined;
}

function buildEntry(
  envelope: CcEnvelope,
  toolUseIdToEventId: Map<string, string>,
): Entry | undefined {
  if (envelope.uuid === undefined || envelope.timestamp === undefined) return undefined;

  const base = {
    id: envelope.uuid,
    ts: envelope.timestamp,
    source: {
      agent: "claude-code" as const,
      ...(envelope.type !== undefined ? { original_type: envelope.type } : {}),
      ...(envelope.version !== undefined ? { schema_version: envelope.version } : {}),
      raw: envelope as unknown as Record<string, unknown>,
    },
  };

  if (envelope.type === "user") {
    const content = envelope.message?.content;
    if (typeof content === "string") {
      return {
        ...base,
        type: "user_message",
        payload: { text: content },
      } as Entry;
    }
    if (Array.isArray(content)) {
      const toolResult = content.find(
        (b): b is { type: "tool_result"; tool_use_id?: string; content?: unknown } =>
          typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_result",
      );
      if (toolResult !== undefined) {
        const callId = toolResult.tool_use_id;
        const forId = callId !== undefined ? toolUseIdToEventId.get(callId) : undefined;
        const output =
          typeof toolResult.content === "string"
            ? toolResult.content
            : JSON.stringify(toolResult.content);
        return {
          ...base,
          type: "tool_result",
          payload: {
            ...(forId !== undefined ? { for_id: forId } : {}),
            ok: true,
            output,
          },
          ...(callId !== undefined ? { semantic: { call_id: callId } } : {}),
        } as Entry;
      }
    }
  }

  if (envelope.type === "assistant") {
    const blocks = envelope.message?.content;
    if (Array.isArray(blocks)) {
      const toolUse = blocks.find(
        (b): b is { type: "tool_use"; id?: string; name?: string; input?: unknown } =>
          typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_use",
      );
      if (toolUse !== undefined) {
        if (toolUse.id !== undefined) toolUseIdToEventId.set(toolUse.id, envelope.uuid);
        return {
          ...base,
          type: "tool_call",
          payload: {
            tool: "other",
            args: {
              ...(toolUse.name !== undefined ? { name: toolUse.name } : {}),
              ...(toolUse.input !== undefined ? { args: toolUse.input } : {}),
            },
          },
          ...(toolUse.id !== undefined ? { semantic: { call_id: toolUse.id } } : {}),
        } as Entry;
      }
      const textBlocks = blocks.filter(
        (b): b is { type: "text"; text: string } =>
          typeof b === "object" &&
          b !== null &&
          (b as { type?: string }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string",
      );
      if (textBlocks.length > 0) {
        const text = textBlocks.map((b) => b.text).join("\n\n");
        const model = envelope.message?.model;
        return {
          ...base,
          type: "agent_message",
          payload: {
            text,
            ...(typeof model === "string" ? { model } : {}),
          },
        } as Entry;
      }
    }
  }

  if (envelope.type === "summary") {
    const content = envelope.message?.content;
    const text = typeof content === "string" ? content : JSON.stringify(content);
    return {
      ...base,
      type: "session_summary",
      payload: { scope: "session", text },
    } as Entry;
  }

  return undefined;
}

export function parseClaudeCodeJsonl(text: string): TrailFile {
  const envelopes = parseLines(text);
  const header = buildHeader(envelopes);
  const parentByUuid = new Map<string, string | null>();
  for (const env of envelopes) {
    if (typeof env.uuid === "string") {
      parentByUuid.set(env.uuid, env.parentUuid ?? null);
    }
  }

  const toolUseIdToEventId = new Map<string, string>();
  const built: { entry: Entry; parentUuid: string | null | undefined }[] = [];
  for (const envelope of envelopes) {
    if (!isTracerEnvelope(envelope)) continue;
    const entry = buildEntry(envelope, toolUseIdToEventId);
    if (entry !== undefined) built.push({ entry, parentUuid: envelope.parentUuid });
  }

  const emittedUuids = new Set(built.map((b) => b.entry.id));
  const entries: Entry[] = built.map(({ entry, parentUuid }) => {
    const resolved = resolveParentId(parentUuid, parentByUuid, emittedUuids);
    return resolved !== undefined ? { ...entry, parent_id: resolved } : entry;
  });

  return { header, entries };
}
