import type { Entry, Header } from "@agent-trail/types";
import { deriveSynthesizedEntryId, OPENCODE_ENTRY_ID_NAMESPACE } from "../session-uid.ts";
import { attachmentFrom, attachmentsFrom } from "./attachments.ts";
import {
  compactDiffs,
  todoItemsFrom,
  tokenTotalsFromSession,
  worktreeFromProject,
} from "./metadata.ts";
import {
  arrayValue,
  type LoadedSession,
  metaFor,
  numberValue,
  objectValue,
  partTimestamp,
  type Raw,
  SOURCE_SCHEMA_VERSION,
  sourceFor,
  sourceId,
  stringValue,
  timestampToIso,
} from "./source.ts";
import { mapTool } from "./tools.ts";

const KNOWN_PART_TYPES = new Set([
  "text",
  "subtask",
  "reasoning",
  "file",
  "tool",
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "retry",
  "compaction",
]);

function usageFrom(
  raw: Raw,
): NonNullable<Extract<Entry, { type?: "agent_message" }>["payload"]>["usage"] | undefined {
  const tokens = objectValue(raw.tokens);
  const cache = objectValue(tokens?.cache);
  const input = numberValue(tokens?.input) ?? numberValue(raw.tokens_input);
  const output = numberValue(tokens?.output) ?? numberValue(raw.tokens_output);
  const total = numberValue(tokens?.total) ?? numberValue(raw.tokens_total);
  const reasoning = numberValue(tokens?.reasoning) ?? numberValue(raw.tokens_reasoning);
  const cacheRead = numberValue(cache?.read) ?? numberValue(raw.tokens_cache_read);
  const cacheWrite = numberValue(cache?.write) ?? numberValue(raw.tokens_cache_write);
  if ((input === undefined || output === undefined) && total === undefined) return undefined;
  return {
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    ...(total !== undefined ? { total_tokens: total } : {}),
    ...(reasoning !== undefined ? { reasoning_tokens: reasoning } : {}),
    ...(cacheRead !== undefined ? { cache_read_tokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cache_creation_tokens: cacheWrite } : {}),
  } as NonNullable<Extract<Entry, { type?: "agent_message" }>["payload"]>["usage"];
}

export function entriesFromLoaded(loaded: LoadedSession, header: Header): Entry[] {
  const entries: Entry[] = [];
  const openCalls = new Map<string, string>();
  const schemaVersion = SOURCE_SCHEMA_VERSION;
  const sessionModel = header.agent.model_default;

  function push(draft: Omit<Entry, "id" | "parent_id">, sourceKey: string): Entry {
    const id = deriveSynthesizedEntryId(OPENCODE_ENTRY_ID_NAMESPACE, [
      header.session_uid ?? header.id,
      sourceKey,
      String(draft.type),
    ]);
    const entry = { ...draft, id } as Entry;
    entries.push(entry);
    return entry;
  }

  function pushMetadata(field: string, value: unknown, sourceKey: string): void {
    if (value === undefined || value === null) return;
    push(
      {
        type: "session_metadata_update",
        ts: header.ts,
        payload: { field, value, reason: "external" },
        source: sourceFor(loaded.session, `session.${sourceKey}`, schemaVersion),
        meta: metaFor(`session.${sourceKey}`),
      },
      `session:${sourceKey}`,
    );
  }

  const title = stringValue(loaded.session.title);
  if (title !== undefined) pushMetadata("name", title, "title");
  if (header.agent.model_default !== undefined) {
    pushMetadata("agent.model_default", header.agent.model_default, "model");
  }
  pushMetadata("x-opencode/share_url", stringValue(loaded.session.share_url), "share_url");
  pushMetadata("x-opencode/token_totals", tokenTotalsFromSession(loaded.session), "token_totals");
  const summaryDiffs = compactDiffs(loaded.session.summary_diffs);
  const summary = {
    ...(numberValue(loaded.session.summary_additions) !== undefined
      ? { additions: numberValue(loaded.session.summary_additions) }
      : {}),
    ...(numberValue(loaded.session.summary_deletions) !== undefined
      ? { deletions: numberValue(loaded.session.summary_deletions) }
      : {}),
    ...(numberValue(loaded.session.summary_files) !== undefined
      ? { files: numberValue(loaded.session.summary_files) }
      : {}),
    ...(summaryDiffs !== undefined ? { diffs: summaryDiffs } : {}),
  };
  if (Object.keys(summary).length > 0)
    pushMetadata("x-opencode/session_summary", summary, "summary");
  pushMetadata("x-opencode/revert", objectValue(loaded.session.revert), "revert");
  pushMetadata("x-opencode/session_permission", loaded.session.permission, "permission");
  const state = {
    ...(timestampToIso(loaded.session.time_archived) !== undefined
      ? { archived_at: timestampToIso(loaded.session.time_archived) }
      : {}),
    ...(timestampToIso(loaded.session.time_compacting) !== undefined
      ? { compacting_at: timestampToIso(loaded.session.time_compacting) }
      : {}),
    ...(stringValue(loaded.session.agent) !== undefined
      ? { agent: stringValue(loaded.session.agent) }
      : {}),
    ...(numberValue(loaded.session.cost) !== undefined
      ? { cost: numberValue(loaded.session.cost) }
      : {}),
    ...(objectValue(loaded.session.metadata) !== undefined
      ? { metadata: objectValue(loaded.session.metadata) }
      : {}),
  };
  if (Object.keys(state).length > 0) pushMetadata("x-opencode/session_state", state, "state");
  const projectWorktree = header.vcs?.worktree ?? worktreeFromProject(loaded.project);
  if (projectWorktree !== undefined) {
    push(
      {
        type: "session_metadata_update",
        ts: header.ts,
        payload: { field: "vcs.worktree", value: projectWorktree, reason: "runtime_inferred" },
        source: sourceFor(loaded.project ?? loaded.session, "project.worktree", schemaVersion),
        meta: metaFor("project.worktree"),
      },
      "project:worktree",
    );
  }

  for (const permission of loaded.permissions) {
    push(
      {
        type: "system_event",
        ts: partTimestamp(permission),
        payload: {
          kind: "x-opencode/permission_ruleset",
          data: {
            project_id: stringValue(permission.project_id),
            rules: permission.data,
          },
        },
        source: sourceFor(permission, "permission", schemaVersion),
        meta: metaFor("permission"),
      },
      sourceId(permission, `permission:${entries.length}`),
    );
  }

  for (const message of loaded.messages) {
    const role = stringValue(message.role);
    const messageParts = loaded.partsByMessage.get(message.id) ?? [];
    const messageAttachments = messageParts
      .filter((part) => stringValue(part.type) === "file")
      .flatMap((part) => {
        const attachment = attachmentFrom(part);
        return attachment === undefined ? [] : [attachment];
      });
    const messageUsage = role === "assistant" ? usageFrom(message) : undefined;
    let usageEmitted = false;
    const consumeUsage = (part?: Raw): ReturnType<typeof usageFrom> => {
      if (usageEmitted) return undefined;
      const partUsage = part !== undefined ? usageFrom(part) : undefined;
      const usage =
        messageUsage !== undefined && partUsage !== undefined
          ? { ...partUsage, ...messageUsage }
          : (messageUsage ?? partUsage);
      if (usage === undefined) return undefined;
      usageEmitted = true;
      return usage;
    };
    for (const part of messageParts) {
      const type = stringValue(part.type);
      if (type === "file") continue;
      const rawType = `part.${type ?? "unknown"}`;
      const base = {
        ts: partTimestamp(part, message),
        source: sourceFor(part, rawType, schemaVersion),
        meta: metaFor(rawType),
      };
      if (type === "text") {
        const text = stringValue(part.text);
        if (text === undefined) continue;
        if (role === "user") {
          push(
            {
              ...base,
              type: "user_message",
              payload: {
                text,
                ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
              },
            },
            part.id,
          );
        } else {
          const model = stringValue(message.modelID) ?? sessionModel;
          const usage = consumeUsage(part);
          push(
            {
              ...base,
              type: "agent_message",
              payload: {
                text,
                ...(model !== undefined ? { model } : {}),
                ...(usage !== undefined ? { usage } : {}),
                ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
              },
            },
            part.id,
          );
        }
        continue;
      }
      if (type === "reasoning") {
        const text =
          stringValue(part.text) ??
          (part.encrypted === true || part.encryptedReasoning === true
            ? "[encrypted reasoning]"
            : undefined);
        if (text === undefined) continue;
        const model = stringValue(message.modelID) ?? sessionModel;
        const usage = consumeUsage(part);
        push(
          {
            ...base,
            type: "agent_thinking",
            payload: {
              text,
              ...(model !== undefined ? { model } : {}),
              ...(usage !== undefined ? { usage } : {}),
            },
          },
          part.id,
        );
        continue;
      }
      if (type === "tool") {
        const callID = stringValue(part.callID) ?? stringValue(part.call_id) ?? part.id;
        const state = objectValue(part.state) ?? part;
        const input = objectValue(state.input) ?? objectValue(part.input) ?? {};
        const name =
          stringValue(part.tool) ?? stringValue(part.name) ?? stringValue(state.tool) ?? "unknown";
        const toolRawType = `tool.${name}`;
        const toolBase = {
          ...base,
          source: sourceFor(part, toolRawType, schemaVersion),
          meta: metaFor(toolRawType),
        };
        if (name === "todowrite") {
          const items = todoItemsFrom(input.todos);
          if (items.length > 0) {
            push(
              {
                ...toolBase,
                type: "task_plan_update",
                payload: { items },
              },
              `${part.id}:todos`,
            );
            continue;
          }
        }
        if (name === "lsp_diagnostics") {
          push(
            {
              ...toolBase,
              type: "system_event",
              payload: {
                kind: "x-opencode/diagnostic",
                data: { tool: name, input, output: state.output },
              },
            },
            `${part.id}:diagnostic`,
          );
          continue;
        }
        const mapped = mapTool(name, input);
        const status = stringValue(state.status) ?? stringValue(part.status);
        const existingCallId = openCalls.get(callID);
        let forId = existingCallId;
        if (forId === undefined) {
          const usage = consumeUsage(part);
          const call = push(
            {
              ...toolBase,
              type: "tool_call",
              payload: { ...mapped, ...(usage !== undefined ? { usage } : {}) },
              semantic: { call_id: callID, tool_kind: mapped.tool },
            },
            `${part.id}:call`,
          );
          forId = call.id;
        }
        if (status === "completed" || status === "error" || status === "failed") {
          openCalls.delete(callID);
          const ok = status === "completed";
          const readRange =
            mapped.tool === "file_read" && Array.isArray(mapped.args.range)
              ? mapped.args.range
              : undefined;
          const toolMeta =
            stringValue(state.title) !== undefined ||
            objectValue(state.metadata) !== undefined ||
            objectValue(state.time) !== undefined
              ? {
                  "x-opencode/tool": {
                    ...(stringValue(state.title) !== undefined
                      ? { title: stringValue(state.title) }
                      : {}),
                    ...(objectValue(state.metadata) !== undefined
                      ? { metadata: objectValue(state.metadata) }
                      : {}),
                    ...(objectValue(state.time) !== undefined
                      ? { time: objectValue(state.time) }
                      : {}),
                  },
                }
              : {};
          push(
            {
              ...base,
              source: toolBase.source,
              meta: toolBase.meta,
              type: "tool_result",
              payload: {
                for_id: forId,
                ok,
                ...(stringValue(state.output) !== undefined
                  ? { output: stringValue(state.output) }
                  : {}),
                ...(stringValue(state.error) !== undefined
                  ? { error: stringValue(state.error) }
                  : {}),
                ...(attachmentsFrom(state.attachments).length > 0
                  ? { attachments: attachmentsFrom(state.attachments) }
                  : {}),
                ...(readRange !== undefined || Object.keys(toolMeta).length > 0
                  ? {
                      meta: {
                        ...(readRange !== undefined ? { file_read: { range: readRange } } : {}),
                        ...toolMeta,
                      },
                    }
                  : {}),
              },
              semantic: { call_id: callID, tool_kind: mapped.tool },
            },
            `${part.id}:result`,
          );
        } else if (status === "cancelled" || status === "canceled") {
          openCalls.delete(callID);
          push(
            {
              ...base,
              source: toolBase.source,
              meta: toolBase.meta,
              type: "tool_call_aborted",
              payload: { scope: "tool_call", for_id: forId, reason: "user_interrupt" },
              semantic: { call_id: callID, tool_kind: mapped.tool },
            },
            `${part.id}:aborted`,
          );
        } else {
          openCalls.set(callID, forId);
        }
        continue;
      }
      if (type === "subtask") {
        const prompt = stringValue(part.prompt) ?? stringValue(part.description);
        if (prompt !== undefined) {
          const usage = consumeUsage(part);
          push(
            {
              ...base,
              type: "tool_call",
              payload: {
                tool: "subagent_invoke",
                args: {
                  task: prompt,
                  ...(stringValue(part.agent) !== undefined
                    ? { agent_type: stringValue(part.agent) }
                    : {}),
                },
                ...(usage !== undefined ? { usage } : {}),
              },
              semantic: { call_id: part.id, tool_kind: "subagent_invoke" },
            },
            part.id,
          );
        } else {
          push(
            {
              ...base,
              type: "system_event",
              payload: { kind: "x-opencode/subtask", data: { ...part } },
            },
            part.id,
          );
        }
        continue;
      }
      if (type === "compaction") {
        const summary = stringValue(part.summary) ?? stringValue(part.text);
        if (summary !== undefined) {
          push(
            { ...base, type: "context_compact", payload: { summary, trigger: "auto" } },
            part.id,
          );
        } else {
          push(
            {
              ...base,
              type: "system_event",
              payload: { kind: "x-opencode/compaction", data: { ...part } },
            },
            part.id,
          );
        }
        continue;
      }
      if (type === "step-start" || type === "step-finish") {
        push(
          {
            ...base,
            type: "system_event",
            payload: { kind: type === "step-start" ? "turn_start" : "turn_end", data: { ...part } },
          },
          part.id,
        );
        continue;
      }
      if (type === "patch") {
        push(
          {
            ...base,
            type: "system_event",
            payload: {
              kind: "x-opencode/patch",
              data: {
                ...(stringValue(part.hash) !== undefined ? { hash: stringValue(part.hash) } : {}),
                ...(arrayValue(part.files) !== undefined ? { files: arrayValue(part.files) } : {}),
              },
            },
          },
          part.id,
        );
        continue;
      }
      if (type === "snapshot") {
        push(
          {
            ...base,
            type: "system_event",
            payload: {
              kind: "x-opencode/snapshot",
              data: { snapshot: stringValue(part.snapshot) },
            },
          },
          part.id,
        );
        continue;
      }
      if (type === "agent") {
        push(
          {
            ...base,
            type: "system_event",
            payload: { kind: "x-opencode/agent", data: { name: stringValue(part.name) } },
          },
          part.id,
        );
        continue;
      }
      if (type === "retry") {
        push(
          {
            ...base,
            type: "system_event",
            payload: {
              kind: "x-opencode/retry",
              data: {
                ...(numberValue(part.attempt) !== undefined
                  ? { attempt: numberValue(part.attempt) }
                  : {}),
                ...(part.error !== undefined ? { error: part.error } : {}),
              },
            },
          },
          part.id,
        );
        continue;
      }
      if (type === undefined || !KNOWN_PART_TYPES.has(type)) {
        push(
          {
            ...base,
            type: "system_event",
            payload: { kind: "x-opencode/unknown_record", data: { raw: { ...part } } },
          },
          part.id,
        );
        continue;
      }
      push(
        {
          ...base,
          type: "system_event",
          payload: { kind: `x-opencode/${type ?? "unknown"}`, data: { ...part } },
        },
        part.id,
      );
    }
  }

  if (loaded.todos.length > 0) {
    const first = loaded.todos[0]!;
    const items = todoItemsFrom(loaded.todos);
    push(
      {
        type: "task_plan_update",
        ts: partTimestamp(first),
        payload: { items },
        source: sourceFor({ todos: loaded.todos }, "todo", schemaVersion),
        meta: metaFor("todo"),
      },
      "todo",
    );
  }

  for (const record of loaded.sessionMessages) {
    const type = stringValue(record.type);
    const rawType = `session_message.${type ?? "unknown"}`;
    const sessionMessageBase = {
      ts: partTimestamp(record),
      source: sourceFor(record, rawType, schemaVersion),
      meta: metaFor(rawType),
    };
    if (type === "model-switched") {
      const toModel =
        stringValue(record.to) ?? stringValue(record.to_model) ?? stringValue(record.model);
      if (toModel !== undefined) {
        push(
          {
            ...sessionMessageBase,
            type: "model_change",
            payload: {
              to_model: toModel,
              ...(stringValue(record.from) !== undefined
                ? { from_model: stringValue(record.from) }
                : {}),
              ...(stringValue(record.provider) !== undefined
                ? { to_provider: stringValue(record.provider) }
                : {}),
              trigger: "external",
            },
          },
          sourceId(record, rawType),
        );
        continue;
      }
    }
    push(
      {
        ...sessionMessageBase,
        type: "system_event",
        payload: { kind: "x-opencode/unknown_record", data: { raw: { ...record } } },
      },
      sourceId(record, rawType),
    );
  }

  if (openCalls.size > 0) {
    push(
      {
        type: "session_terminated",
        ts: entries.at(-1)?.ts ?? header.ts,
        payload: { reason: "eof_with_open_tool_calls", open_call_ids: [...openCalls.values()] },
        source: { agent: "opencode", synthesized: true },
        meta: metaFor("session_terminated.eof_with_open_tool_calls"),
      },
      "session-terminated",
    );
  }

  return entries;
}
