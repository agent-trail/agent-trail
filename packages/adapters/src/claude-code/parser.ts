import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";

type CcEnvelope = {
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

type CcBlock = Record<string, unknown> & { type?: string };

type BuiltEntry = {
  entry: Entry;
  parentUuid: string | null | undefined;
  localParentId?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTracerEnvelope(envelope: CcEnvelope): boolean {
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
    envelope.type === "queue-operation"
  );
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
  const first = envelopes.find((env) => isTracerEnvelope(env) && env.timestamp !== undefined);
  const firstSession = envelopes.find(
    (env) => isTracerEnvelope(env) && env.sessionId !== undefined,
  );
  const firstTs = first?.timestamp;
  if (first === undefined || firstTs === undefined || firstSession?.sessionId === undefined) {
    throw new Error("Claude Code session has no parseable records");
  }
  const firstVersion = first.version ?? firstSession.version;
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id: firstSession.sessionId,
    ts: firstTs,
    agent: {
      name: "claude-code",
      ...(firstVersion !== undefined ? { version: firstVersion } : {}),
    },
  };
  if (first.cwd !== undefined) header.cwd = first.cwd;
  header.source = {
    agent: "claude-code",
    ...(firstVersion !== undefined ? { format_version: firstVersion } : {}),
  };
  return header;
}

function resolveParentId(
  startParentUuid: string | null | undefined,
  parentByUuid: Map<string, string | null>,
  sourceUuidToLastEntryId: Map<string, string>,
): string | undefined {
  let cursor: string | null | undefined = startParentUuid;
  const guard = new Set<string>();
  while (typeof cursor === "string") {
    if (guard.has(cursor)) return undefined;
    guard.add(cursor);
    const entryId = sourceUuidToLastEntryId.get(cursor);
    if (entryId !== undefined) return entryId;
    cursor = parentByUuid.get(cursor) ?? undefined;
  }
  return undefined;
}

function sourceFor(
  envelope: CcEnvelope,
  originalType: string | undefined,
  block?: CcBlock,
  blockIndex?: number,
): NonNullable<Entry["source"]> {
  return {
    agent: "claude-code",
    ...(originalType !== undefined ? { original_type: originalType } : {}),
    ...(envelope.version !== undefined ? { schema_version: envelope.version } : {}),
    raw:
      block === undefined
        ? (envelope as unknown as Record<string, unknown>)
        : {
            envelope,
            block,
            block_index: blockIndex,
          },
  };
}

function entryId(envelope: CcEnvelope, suffix?: string): string {
  if (envelope.uuid === undefined) {
    throw new Error("Claude Code entry missing uuid");
  }
  return suffix === undefined ? envelope.uuid : `${envelope.uuid}-${suffix}`;
}

function blockId(envelope: CcEnvelope, kind: string, index: number, totalBlocks: number): string {
  return totalBlocks === 1 ? entryId(envelope) : entryId(envelope, `${kind}-${index}`);
}

function asBlocks(content: unknown): CcBlock[] {
  return Array.isArray(content) ? content.filter(isObject) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function jsonObjectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function jsonString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function textFromToolResultContent(content: unknown): string {
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

function isContinuationPreamble(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("This session is") ||
    trimmed.startsWith("Here is the conversation so far") ||
    trimmed.startsWith("Here's the conversation so far")
  );
}

function maybeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function systemEventText(envelope: CcEnvelope): string {
  if (envelope.type === "system") {
    const subtype = stringValue(envelope.subtype) ?? "system";
    const content = stringValue(envelope.content);
    return content?.trim() ? content : `System event: ${subtype}`;
  }
  if (envelope.type === "progress") {
    const data = jsonObjectValue(envelope.data);
    const dataType = stringValue(data?.type) ?? "progress";
    if (dataType === "hook_progress") {
      const hookEvent = stringValue(data?.hookEvent) ?? "hook";
      const hookName = stringValue(data?.hookName);
      return hookName?.trim()
        ? `Hook progress: ${hookEvent} (${hookName})`
        : `Hook progress: ${hookEvent}`;
    }
    const message = stringValue(data?.message);
    return message?.trim() ? `Progress: ${message.trim()}` : `Progress: ${dataType}`;
  }
  if (envelope.type === "queue-operation") {
    const operation = stringValue(envelope.operation) ?? "unknown";
    const content = stringValue(envelope.content);
    return operation === "enqueue" && content?.trim()
      ? `Queued input: ${content.trim()}`
      : `Queue operation: ${operation}`;
  }
  return "System event";
}

function systemEventKind(envelope: CcEnvelope): string {
  if (envelope.type === "queue-operation") return "queue_operation";
  if (envelope.type === "progress") {
    const data = jsonObjectValue(envelope.data);
    return stringValue(data?.type) === "hook_progress" ? "hook_progress" : "progress";
  }
  return "system";
}

function toolKindAndArgs(name: string | undefined, input: unknown): { tool: string; args: object } {
  const args = jsonObjectValue(input) ?? {};
  switch (name) {
    case "Bash": {
      const command = stringValue(args.command);
      if (command !== undefined) {
        return {
          tool: "shell_command",
          args: {
            command,
            ...(stringValue(args.cwd) !== undefined ? { cwd: stringValue(args.cwd) } : {}),
            ...(maybeNumber(args.timeout) !== undefined
              ? { timeout: maybeNumber(args.timeout) }
              : {}),
          },
        };
      }
      break;
    }
    case "Read": {
      const path = stringValue(args.file_path) ?? stringValue(args.path);
      if (path !== undefined) return { tool: "file_read", args: { path } };
      break;
    }
    case "Write": {
      const path = stringValue(args.file_path) ?? stringValue(args.path);
      const content = stringValue(args.content);
      if (path !== undefined && content !== undefined)
        return { tool: "file_write", args: { path, content } };
      break;
    }
    case "Edit": {
      const path = stringValue(args.file_path) ?? stringValue(args.path);
      const oldString = stringValue(args.old_string);
      const newString = stringValue(args.new_string);
      if (path !== undefined && (oldString !== undefined || newString !== undefined)) {
        const diff = [
          `--- a/${path}`,
          `+++ b/${path}`,
          "@@",
          `-${oldString ?? ""}`,
          `+${newString ?? ""}`,
        ].join("\n");
        return { tool: "file_edit", args: { path, diff } };
      }
      break;
    }
    case "NotebookEdit": {
      const path =
        stringValue(args.notebook_path) ?? stringValue(args.file_path) ?? stringValue(args.path);
      if (path !== undefined) {
        return {
          tool: "notebook_edit",
          args: {
            path,
            ...(stringValue(args.cell_id) !== undefined
              ? { cell_id: stringValue(args.cell_id) }
              : {}),
            ...(stringValue(args.new_source) !== undefined
              ? { content: stringValue(args.new_source) }
              : {}),
          },
        };
      }
      break;
    }
    case "Grep": {
      const query = stringValue(args.pattern) ?? stringValue(args.query);
      if (query !== undefined) {
        return {
          tool: "file_search",
          args: {
            query,
            ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
            ...(stringValue(args.glob) !== undefined ? { glob: stringValue(args.glob) } : {}),
          },
        };
      }
      break;
    }
    case "Glob": {
      const pattern = stringValue(args.pattern);
      if (pattern !== undefined)
        return { tool: "file_search", args: { query: pattern, glob: pattern } };
      break;
    }
    case "WebFetch": {
      const url = stringValue(args.url);
      if (url !== undefined) return { tool: "web_fetch", args: { url } };
      break;
    }
    case "WebSearch": {
      const query = stringValue(args.query);
      if (query !== undefined) return { tool: "web_search", args: { query } };
      break;
    }
    case "TodoWrite": {
      return {
        tool: "task_plan",
        args: { ...(Array.isArray(args.todos) ? { items: args.todos.map(jsonString) } : {}) },
      };
    }
    case "Task": {
      const task =
        stringValue(args.prompt) ?? stringValue(args.description) ?? stringValue(args.name);
      if (task !== undefined) {
        return {
          tool: "subagent_invoke",
          args: {
            task,
            ...(stringValue(args.subagent_type) !== undefined
              ? { agent_type: stringValue(args.subagent_type) }
              : {}),
            ...(stringValue(args.session_id) !== undefined
              ? { session_id: stringValue(args.session_id) }
              : {}),
          },
        };
      }
      break;
    }
  }
  return {
    tool: "other",
    args: {
      ...(name !== undefined ? { name } : { name: "unknown" }),
      ...(isObject(input) ? { args: input } : {}),
    },
  };
}

function baseEntry(
  envelope: CcEnvelope,
  id: string,
  originalType: string | undefined,
  block?: CcBlock,
  blockIndex?: number,
) {
  if (envelope.timestamp === undefined) return undefined;
  return {
    id,
    ts: envelope.timestamp,
    source: sourceFor(envelope, originalType, block, blockIndex),
  };
}

function buildEntries(
  envelope: CcEnvelope,
  toolUseIdToEventId: Map<string, string>,
  toolUseIdToToolKind: Map<string, string>,
): Entry[] {
  if (envelope.uuid === undefined || envelope.timestamp === undefined) return [];

  if (
    envelope.type === "system" ||
    envelope.type === "progress" ||
    envelope.type === "queue-operation"
  ) {
    const base = baseEntry(envelope, entryId(envelope), envelope.type);
    if (base === undefined) return [];
    const data = envelope.type === "progress" ? jsonObjectValue(envelope.data) : undefined;
    return [
      {
        ...base,
        type: "system_event",
        payload: {
          kind: systemEventKind(envelope),
          text: systemEventText(envelope),
          ...(data !== undefined ? { data } : {}),
        },
      } as Entry,
    ];
  }

  if (envelope.type === "summary") {
    const text =
      stringValue(envelope.summary) ??
      stringValue(envelope.message?.content) ??
      jsonString(envelope.message?.content);
    const base = baseEntry(envelope, entryId(envelope), "summary");
    if (base === undefined) return [];
    if (envelope.isCompactSummary === true) {
      return [
        {
          ...base,
          type: "context_compact",
          payload: { summary: text, trigger: "auto" },
        } as Entry,
      ];
    }
    return [
      {
        ...base,
        type: "session_summary",
        payload: { scope: "session", text },
        semantic: {
          ...(typeof envelope.leafUuid === "string" ? { group_id: envelope.leafUuid } : {}),
        },
      } as Entry,
    ];
  }

  const content = envelope.message?.content;
  if (envelope.type === "user") {
    if (typeof content === "string") {
      const base = baseEntry(envelope, entryId(envelope), "user");
      if (base === undefined) return [];
      if (isContinuationPreamble(content)) {
        return [
          {
            ...base,
            type: "system_event",
            payload: { kind: "system", text: content },
          } as Entry,
        ];
      }
      return [{ ...base, type: "user_message", payload: { text: content } } as Entry];
    }

    const blocks = asBlocks(content);
    const emittedBlocks = blocks.filter(
      (block) => block.type === "text" || block.type === "tool_result",
    );
    return emittedBlocks.flatMap((block, emittedIndex) => {
      const id = blockId(envelope, block.type ?? "block", emittedIndex, emittedBlocks.length);
      const base = baseEntry(envelope, id, block.type, block, emittedIndex);
      if (base === undefined) return [];
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text;
        return [
          isContinuationPreamble(text)
            ? ({
                ...base,
                type: "system_event",
                payload: { kind: "system", text },
              } as Entry)
            : ({ ...base, type: "user_message", payload: { text } } as Entry),
        ];
      }
      if (block.type === "tool_result") {
        const callId = stringValue(block.tool_use_id);
        const forId = callId !== undefined ? toolUseIdToEventId.get(callId) : undefined;
        const toolKind = callId !== undefined ? toolUseIdToToolKind.get(callId) : undefined;
        const ok = block.is_error !== true;
        const output = textFromToolResultContent(block.content);
        return [
          {
            ...base,
            type: "tool_result",
            payload: {
              ...(forId !== undefined ? { for_id: forId } : {}),
              ok,
              ...(output.length > 0 ? { output } : {}),
              ...(!ok && output.length > 0 ? { error: output } : {}),
            },
            ...(callId !== undefined || toolKind !== undefined
              ? {
                  semantic: {
                    ...(callId !== undefined ? { call_id: callId } : {}),
                    ...(toolKind !== undefined ? { tool_kind: toolKind } : {}),
                  },
                }
              : {}),
          } as Entry,
        ];
      }
      return [];
    });
  }

  if (envelope.type === "assistant") {
    const blocks = asBlocks(content);
    const emittedBlocks = blocks.filter(
      (block) =>
        block.type === "text" ||
        block.type === "thinking" ||
        block.type === "redacted_thinking" ||
        block.type === "tool_use",
    );
    return emittedBlocks.flatMap((block, emittedIndex) => {
      const id = blockId(envelope, block.type ?? "block", emittedIndex, emittedBlocks.length);
      const base = baseEntry(envelope, id, block.type, block, emittedIndex);
      if (base === undefined) return [];
      const model = envelope.message?.model;
      if (block.type === "text" && typeof block.text === "string") {
        return [
          {
            ...base,
            type: "agent_message",
            payload: {
              text: block.text,
              ...(typeof model === "string" ? { model } : {}),
              ...(typeof envelope.message?.stop_reason === "string"
                ? { stop_reason: envelope.message.stop_reason }
                : {}),
            },
          } as Entry,
        ];
      }
      if (block.type === "thinking" || block.type === "redacted_thinking") {
        const text =
          stringValue(block.thinking) ??
          stringValue(block.data) ??
          (block.type === "redacted_thinking" ? "[redacted thinking]" : "");
        if (text.length === 0) return [];
        return [
          {
            ...base,
            type: "agent_thinking",
            payload: {
              text,
              ...(typeof model === "string" ? { model } : {}),
            },
          } as Entry,
        ];
      }
      if (block.type === "tool_use") {
        const name = stringValue(block.name);
        const callId = stringValue(block.id);
        const mapped = toolKindAndArgs(name, block.input);
        if (callId !== undefined) {
          toolUseIdToEventId.set(callId, id);
          toolUseIdToToolKind.set(callId, mapped.tool);
        }
        return [
          {
            ...base,
            type: "tool_call",
            payload: mapped,
            semantic: {
              ...(callId !== undefined ? { call_id: callId } : {}),
              tool_kind: mapped.tool,
            },
          } as Entry,
        ];
      }
      return [];
    });
  }

  return [];
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
  const toolUseIdToToolKind = new Map<string, string>();
  const built: BuiltEntry[] = [];
  const sourceUuidToLastEntryId = new Map<string, string>();
  for (const envelope of envelopes) {
    if (!isTracerEnvelope(envelope)) continue;
    const entries = buildEntries(envelope, toolUseIdToEventId, toolUseIdToToolKind);
    entries.forEach((entry, index) => {
      built.push({
        entry,
        parentUuid: envelope.parentUuid,
        ...(index > 0 ? { localParentId: entries[index - 1]?.id } : {}),
      });
    });
    if (typeof envelope.uuid === "string" && entries.length > 0) {
      sourceUuidToLastEntryId.set(envelope.uuid, entries[entries.length - 1]?.id ?? envelope.uuid);
    }
  }

  const entries: Entry[] = built.map(({ entry, parentUuid, localParentId }) => {
    const resolved =
      localParentId ?? resolveParentId(parentUuid, parentByUuid, sourceUuidToLastEntryId);
    return resolved !== undefined ? { ...entry, parent_id: resolved } : entry;
  });

  return { header, entries };
}
