import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import {
  AGENT_NAME,
  buildExecCommandEndData,
  canonicalCustomToolName,
  codexUsageFromTokenCount,
  durationToMs,
  excerpt,
  mapTool,
  parseFunctionArguments,
  patchSingleFilePath,
  stripSpinner,
} from "../parser.ts";
import { isObject, numericValue, stringValue, timestampToIso } from "../source.ts";

type Raw = Record<string, unknown>;

/**
 * Private meta key on a transient pass-1 carrier `system_event`: token_count maps
 * to a carrier holding the mapped usage here, and `codexTokenRollup` folds it into
 * the preceding agent_message's `payload.usage` then drops the carrier. The final
 * trail never contains the carrier or this key.
 */
export const USAGE_CARRIER = "x-codex/_usage";

const RAW_TYPE = "dev.codex.raw_type";

function payloadOf(record: Raw): Raw {
  return isObject(record.payload) ? record.payload : {};
}

function emittable(record: Raw): boolean {
  return timestampToIso(record.timestamp) !== undefined;
}

function source(originalType: string, raw?: Raw, synthesized?: boolean): Entry["source"] {
  return {
    agent: AGENT_NAME,
    original_type: originalType,
    ...(raw !== undefined ? { raw } : {}),
    ...(synthesized === true ? { synthesized: true } : {}),
  };
}

function meta(rawType: string, callId?: string): Record<string, unknown> {
  return {
    ...(callId !== undefined ? { linker: { call_id: callId } } : {}),
    [RAW_TYPE]: rawType,
  };
}

function message(payloadType: "user_message" | "agent_message"): MappingDef<Raw> {
  const rawType = `event_msg.${payloadType}`;
  return defineMapping<Raw>({
    match: { type: "event_msg", payload: { type: payloadType } },
    emit: (record) => {
      if (!emittable(record)) return [];
      const p = payloadOf(record);
      const text = stringValue(p.message) ?? stringValue(p.text);
      if (text === undefined || text.length === 0) return [];
      return [
        {
          type: payloadType === "user_message" ? "user_message" : "agent_message",
          payload: { text },
          source: source(rawType),
          meta: meta(rawType),
        },
      ];
    },
  });
}

const functionCall = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "function_call" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const callId = stringValue(p.call_id);
    const parsed = parseFunctionArguments(p.arguments);
    const mapping = mapTool(stringValue(p.name), parsed.args);
    const raw =
      parsed.rawUnparseable !== undefined ? { arguments: parsed.rawUnparseable } : undefined;
    return [
      {
        type: "tool_call",
        payload: { tool: mapping.tool, args: mapping.args },
        semantic: { tool_kind: mapping.tool },
        source: source("response_item.function_call", raw),
        meta: meta("response_item.function_call", callId),
      },
    ];
  },
});

const customToolCall = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "custom_tool_call" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const callId = stringValue(p.call_id);
    const input = stringValue(p.input) ?? "";
    const canonicalName = canonicalCustomToolName(stringValue(p.name));
    let tool: ToolKind = "other";
    let args: Raw = { name: canonicalName, args: { input } };
    if (canonicalName === "apply_patch") {
      const path = patchSingleFilePath(input);
      if (path !== undefined) {
        tool = "file_edit";
        args = { path, diff: input };
      }
    }
    return [
      {
        type: "tool_call",
        payload: { tool, args },
        semantic: { tool_kind: tool },
        source: source("response_item.custom_tool_call"),
        meta: meta("response_item.custom_tool_call", callId),
      },
    ];
  },
});

function toolResult(
  payloadType: "function_call_output" | "custom_tool_call_output",
): MappingDef<Raw> {
  const rawType = `response_item.${payloadType}`;
  return defineMapping<Raw>({
    match: { type: "response_item", payload: { type: payloadType } },
    emit: (record) => {
      if (!emittable(record)) return [];
      const p = payloadOf(record);
      const callId = stringValue(p.call_id);
      const rawOutput = p.output;
      const outputRaw =
        typeof rawOutput === "string"
          ? rawOutput
          : rawOutput === undefined
            ? ""
            : JSON.stringify(rawOutput);
      const ok = p.success !== false;
      return [
        {
          type: "tool_result",
          payload: { ok, output: stripSpinner(outputRaw) },
          source: source(rawType),
          meta: meta(rawType, callId),
        },
      ];
    },
  });
}

const webSearchCall = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "web_search_call" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const action = isObject(p.action) ? p.action : {};
    const actionType = stringValue(action.type);
    const queries = Array.isArray(action.queries) ? action.queries : [];
    const firstQuery = queries.find((q): q is string => typeof q === "string");
    const query = firstQuery ?? stringValue(action.query);
    let tool: ToolKind;
    let payload: Raw;
    if (actionType === "search" && query !== undefined) {
      tool = "web_search";
      payload = { tool, args: { query } };
    } else {
      tool = "other";
      payload = { tool, args: { name: "web_search_call", args: { action } } };
    }
    return [
      {
        type: "tool_call",
        payload,
        semantic: { tool_kind: tool },
        source: source("response_item.web_search_call"),
        meta: meta("response_item.web_search_call"),
      },
    ];
  },
});

const toolSearchCall = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "tool_search_call" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const callId = stringValue(p.call_id);
    const parsed = parseFunctionArguments(p.arguments);
    const raw =
      parsed.rawUnparseable !== undefined ? { arguments: parsed.rawUnparseable } : undefined;
    return [
      {
        type: "tool_call",
        payload: { tool: "other", args: { name: "tool_search", args: parsed.args } },
        semantic: { tool_kind: "other" },
        source: source("response_item.tool_search_call", raw),
        meta: meta("response_item.tool_search_call", callId),
      },
    ];
  },
});

const toolSearchOutput = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "tool_search_output" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const callId = stringValue(p.call_id);
    const output = Array.isArray(p.tools) ? JSON.stringify(p.tools) : (stringValue(p.output) ?? "");
    return [
      {
        type: "tool_result",
        payload: { ok: true, output },
        source: source("response_item.tool_search_output"),
        meta: meta("response_item.tool_search_output", callId),
      },
    ];
  },
});

const compacted = defineMapping<Raw>({
  match: { type: "compacted" },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const summary = stringValue(p.message) ?? stringValue(p.summary);
    if (summary === undefined || summary.length === 0) return [];
    const payload: Raw = { summary, trigger: "auto" };
    const tokensBefore = numericValue(p.tokens_before);
    if (tokensBefore !== undefined) payload.tokens_before = Math.trunc(tokensBefore);
    const tokensAfter = numericValue(p.tokens_after);
    if (tokensAfter !== undefined) payload.tokens_after = Math.trunc(tokensAfter);
    return [
      {
        type: "context_compact",
        payload,
        source: source("compacted"),
        meta: meta("compacted"),
      },
    ];
  },
});

const tokenCount = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "token_count" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const usage = codexUsageFromTokenCount(payloadOf(record));
    if (usage === undefined) return [];
    // Transient carrier folded into the preceding agent_message by
    // codexTokenRollup, then dropped.
    return [
      { type: "system_event", payload: { kind: USAGE_CARRIER }, meta: { [USAGE_CARRIER]: usage } },
    ];
  },
});

function systemEventDraft(
  kind: string,
  rawType: string,
  data: Raw,
  linkedCallId?: string,
): TrailEntryDraft {
  const payload: Raw = { kind };
  if (Object.keys(data).length > 0) payload.data = data;
  return {
    type: "system_event",
    payload,
    ...(linkedCallId !== undefined ? { semantic: { call_id: linkedCallId } } : {}),
    source: source(rawType),
    meta: meta(rawType),
  };
}

function lifecycle(
  payloadType: string,
  build: (p: Raw) => { kind: string; rawType: string; data: Raw; linkedCallId?: string },
): MappingDef<Raw> {
  return defineMapping<Raw>({
    match: { type: "event_msg", payload: { type: payloadType } },
    emit: (record) => {
      if (!emittable(record)) return [];
      const { kind, rawType, data, linkedCallId } = build(payloadOf(record));
      return [systemEventDraft(kind, rawType, data, linkedCallId)];
    },
  });
}

const taskStarted = lifecycle("task_started", (p) => {
  const data: Raw = {};
  const turnId = stringValue(p.turn_id);
  if (turnId !== undefined) data.turn_id = turnId;
  const startedAt = numericValue(p.started_at);
  if (startedAt !== undefined) data.started_at = startedAt;
  const contextWindow = numericValue(p.model_context_window);
  if (contextWindow !== undefined) data.model_context_window = Math.trunc(contextWindow);
  const collabMode = stringValue(p.collaboration_mode_kind);
  if (collabMode !== undefined) data.collaboration_mode_kind = collabMode;
  return { kind: "task_started", rawType: "event_msg.task_started", data };
});

const taskCompleted = lifecycle("task_complete", (p) => {
  const data: Raw = {};
  const turnId = stringValue(p.turn_id);
  if (turnId !== undefined) data.turn_id = turnId;
  const completedAt = numericValue(p.completed_at);
  if (completedAt !== undefined) data.completed_at = completedAt;
  const durationMs = numericValue(p.duration_ms);
  if (durationMs !== undefined) data.duration_ms = Math.trunc(durationMs);
  const ttft = numericValue(p.time_to_first_token_ms);
  if (ttft !== undefined) data.time_to_first_token_ms = Math.trunc(ttft);
  const lastMessage = stringValue(p.last_agent_message);
  if (lastMessage !== undefined) data.last_agent_message = lastMessage;
  return { kind: "task_completed", rawType: "event_msg.task_complete", data };
});

const execCommandEnd = lifecycle("exec_command_end", (p) => ({
  kind: "x-codex/exec_command_end",
  rawType: "event_msg.exec_command_end",
  data: buildExecCommandEndData(p),
  linkedCallId: stringValue(p.call_id),
}));

const patchApplyEnd = lifecycle("patch_apply_end", (p) => {
  const data: Raw = {};
  if (typeof p.success === "boolean") data.success = p.success;
  if (isObject(p.changes)) data.changes = p.changes;
  const stdoutE = excerpt(stringValue(p.stdout));
  if (stdoutE !== undefined) data.stdout_excerpt = stdoutE;
  const stderrE = excerpt(stringValue(p.stderr));
  if (stderrE !== undefined) data.stderr_excerpt = stderrE;
  const status = stringValue(p.status);
  if (status !== undefined) data.status = status;
  return {
    kind: "x-codex/patch_apply_end",
    rawType: "event_msg.patch_apply_end",
    data,
    linkedCallId: stringValue(p.call_id),
  };
});

const mcpToolCallEnd = lifecycle("mcp_tool_call_end", (p) => {
  const data: Raw = {};
  const pluginId = stringValue(p.plugin_id);
  if (pluginId !== undefined) data.plugin_id = pluginId;
  if (isObject(p.invocation)) data.invocation = p.invocation;
  const duration = durationToMs(p.duration);
  if (duration !== undefined) data.duration_ms = duration;
  if (isObject(p.result)) data.result_ok = "Ok" in p.result;
  return {
    kind: "x-codex/mcp_tool_call_end",
    rawType: "event_msg.mcp_tool_call_end",
    data,
    linkedCallId: stringValue(p.call_id),
  };
});

const threadGoalUpdated = lifecycle("thread_goal_updated", (p) => {
  const data: Raw = {};
  const threadId = stringValue(p.threadId) ?? stringValue(p.thread_id);
  if (threadId !== undefined) data.thread_id = threadId;
  const turnId = stringValue(p.turnId) ?? stringValue(p.turn_id);
  if (turnId !== undefined) data.turn_id = turnId;
  if (isObject(p.goal)) data.goal = p.goal;
  return { kind: "x-codex/thread_goal_updated", rawType: "event_msg.thread_goal_updated", data };
});

const webSearchEnd = lifecycle("web_search_end", (p) => {
  const data: Raw = {};
  const query = stringValue(p.query);
  if (query !== undefined) data.query = query;
  if (isObject(p.action)) data.action = p.action;
  const sourceCallId = stringValue(p.call_id);
  if (sourceCallId !== undefined) data.call_id = sourceCallId;
  return { kind: "x-codex/web_search_end", rawType: "event_msg.web_search_end", data };
});

export const codexMappings: MappingDef<Raw>[] = [
  message("user_message"),
  message("agent_message"),
  functionCall,
  toolResult("function_call_output"),
  customToolCall,
  toolResult("custom_tool_call_output"),
  webSearchCall,
  toolSearchCall,
  toolSearchOutput,
  compacted,
  tokenCount,
  taskStarted,
  taskCompleted,
  execCommandEnd,
  patchApplyEnd,
  mcpToolCallEnd,
  threadGoalUpdated,
  webSearchEnd,
];
