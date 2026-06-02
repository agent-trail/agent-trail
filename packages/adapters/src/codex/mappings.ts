import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import type { Attachment, Entry, ToolKind } from "@agent-trail/types";
import {
  isNonEmptyString,
  isTaskPlanStatus,
  normalizeTaskPlanContent,
  type TaskPlanItem,
  taskPlanItemId,
} from "../task-plan.ts";
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
} from "./parser.ts";
import { isObject, numericValue, stringValue, timestampToIso } from "./source.ts";

type Raw = Record<string, unknown>;
type UserQueryOption = { label: string; description?: string };

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

function taskPlanItemsFromUpdatePlan(args: Record<string, unknown>): TaskPlanItem[] | undefined {
  if (!Array.isArray(args.plan)) return undefined;
  const items: TaskPlanItem[] = [];
  const occurrenceByContent = new Map<string, number>();
  for (const rawItem of args.plan) {
    if (!isObject(rawItem)) return undefined;
    const content = stringValue(rawItem.step);
    const status = rawItem.status;
    if (content === undefined || !isTaskPlanStatus(status)) return undefined;
    const normalized = normalizeTaskPlanContent(content);
    const occurrence = occurrenceByContent.get(normalized) ?? 0;
    occurrenceByContent.set(normalized, occurrence + 1);
    items.push({
      id: taskPlanItemId(rawItem.id, occurrence, content),
      content,
      status,
    });
  }
  return items;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionObjects(value: unknown): UserQueryOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value
    .map((option) => {
      if (typeof option === "string") return { label: option };
      if (!isObject(option)) return undefined;
      const label = stringValue(option.label);
      if (label === undefined) return undefined;
      const description = stringValue(option.description);
      return { label, ...(description !== undefined ? { description } : {}) };
    })
    .filter((option): option is UserQueryOption => option !== undefined);
  return options.length === value.length ? options : undefined;
}

function userQueryQuestion(raw: Raw, fallbackIndex: number): Record<string, unknown> | undefined {
  const question = stringValue(raw.question);
  if (question === undefined) return undefined;
  const id =
    stringValue(raw.id) ?? (fallbackIndex === 0 ? "question" : `question-${fallbackIndex}`);
  const out: Record<string, unknown> = { id, question };
  const header = stringValue(raw.header);
  if (header !== undefined) out.header = header;
  const multiSelect = booleanValue(raw.multi_select) ?? booleanValue(raw.multiSelect);
  if (multiSelect !== undefined) out.multi_select = multiSelect;
  const isSecret = booleanValue(raw.is_secret) ?? booleanValue(raw.isSecret);
  if (isSecret !== undefined) out.is_secret = isSecret;
  const allowOther =
    booleanValue(raw.allow_other) ??
    booleanValue(raw.allowOther) ??
    booleanValue(raw.is_other) ??
    booleanValue(raw.isOther);
  if (allowOther !== undefined) out.allow_other = allowOther;
  const options = optionObjects(raw.options) ?? optionObjects(raw.choices);
  if (options !== undefined) out.options = options;
  return out;
}

function userQueryPayload(args: Raw): { questions: Record<string, unknown>[] } | undefined {
  if (Array.isArray(args.questions)) {
    const questions = args.questions
      .filter(isObject)
      .map((question, index) => userQueryQuestion(question, index))
      .filter((question): question is Record<string, unknown> => question !== undefined);
    if (questions.length > 0) return { questions };
  }
  const question = userQueryQuestion(args, 0);
  return question !== undefined ? { questions: [question] } : undefined;
}

function capabilityMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = {};
  const namespace = stringValue(value.namespace);
  if (namespace !== undefined) metadata.namespace = namespace;
  const description = stringValue(value.description);
  if (description !== undefined) metadata.description = description;
  const deferLoading = value.defer_loading ?? value.deferLoading;
  if (typeof deferLoading === "boolean") metadata.defer_loading = deferLoading;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

const sessionDynamicTools = defineMapping<Raw>({
  match: { type: "session_meta" },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const tools = Array.isArray(p.dynamic_tools)
      ? p.dynamic_tools
      : Array.isArray(p.dynamicTools)
        ? p.dynamicTools
        : [];
    const snapshot = tools.flatMap((tool) => {
      if (!isObject(tool)) return [];
      const name = stringValue(tool.name);
      if (name === undefined) return [];
      const metadata = capabilityMetadata(tool);
      return [{ name, ...(metadata !== undefined ? { metadata } : {}) }];
    });
    if (snapshot.length === 0) return [];
    return [
      {
        type: "capability_change",
        payload: { scope: "tool", reason: "loaded", snapshot },
        source: source("session_meta.dynamic_tools"),
        meta: meta("session_meta.dynamic_tools"),
      },
    ];
  },
});

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
    const name = stringValue(p.name);
    const raw =
      parsed.rawUnparseable !== undefined ? { arguments: parsed.rawUnparseable } : undefined;
    const taskPlanItems =
      name === "update_plan" ? taskPlanItemsFromUpdatePlan(parsed.args) : undefined;
    if (taskPlanItems !== undefined) {
      const explanation = stringValue(parsed.args.explanation);
      const taskPlanCallId = isNonEmptyString(callId) ? callId : undefined;
      return [
        {
          type: "task_plan_update",
          payload: {
            ...(explanation !== undefined ? { explanation } : {}),
            items: taskPlanItems,
          },
          ...(taskPlanCallId !== undefined ? { semantic: { call_id: taskPlanCallId } } : {}),
          source: source("response_item.function_call", raw),
          meta: meta("response_item.function_call", taskPlanCallId),
        } as TrailEntryDraft,
      ];
    }
    if (name === "request_user_input") {
      const payload = userQueryPayload(parsed.args);
      if (payload !== undefined) {
        const queryCallId = isNonEmptyString(callId) ? callId : undefined;
        return [
          {
            type: "user_query",
            payload,
            ...(queryCallId !== undefined ? { semantic: { call_id: queryCallId } } : {}),
            source: source("response_item.function_call", raw),
            meta: meta("response_item.function_call", queryCallId),
          },
        ];
      }
    }
    const mapping = mapTool(name, parsed.args);
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

function functionCallOutputText(rawOutput: unknown): string {
  const body = isObject(rawOutput) && "body" in rawOutput ? rawOutput.body : rawOutput;
  if (typeof body === "string") return body;
  if (body === undefined) return "";
  return JSON.stringify(body);
}

function functionCallOutputOk(payload: Raw, rawOutput: unknown): boolean {
  if (isObject(rawOutput) && typeof rawOutput.success === "boolean") return rawOutput.success;
  return payload.success !== false;
}

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
      const output = stripSpinner(functionCallOutputText(rawOutput));
      const ok = functionCallOutputOk(p, rawOutput);
      return [
        {
          type: "tool_result",
          payload: {
            ok,
            output,
            ...(!ok && output.length > 0 ? { error: output } : {}),
          },
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
    } else if (actionType === "open_page" && stringValue(action.url) !== undefined) {
      tool = "web_fetch";
      payload = { tool, args: { url: stringValue(action.url) } };
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
    const query = stringValue(parsed.args.query) ?? stringValue(parsed.args.q);
    const limit = numericValue(parsed.args.limit) ?? numericValue(parsed.args.top_k);
    const raw =
      parsed.rawUnparseable !== undefined ? { arguments: parsed.rawUnparseable } : undefined;
    const args: Raw = query !== undefined ? { query } : {};
    if (limit !== undefined) args.limit = Math.trunc(limit);
    const payload =
      query !== undefined
        ? { tool: "tool_search", args }
        : { tool: "other", args: { name: "tool_search", args: parsed.args } };
    const tool: ToolKind = query !== undefined ? "tool_search" : "other";
    return [
      {
        type: "tool_call",
        payload,
        semantic: { tool_kind: tool },
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

function diagnosticCode(payload: Raw): string | undefined {
  const info = isObject(payload.codex_error_info) ? payload.codex_error_info : undefined;
  return stringValue(info?.code) ?? stringValue(info?.type) ?? stringValue(payload.code);
}

function diagnosticMessageData(payload: Raw, severity: string): Raw {
  const data: Raw = { severity };
  const code = diagnosticCode(payload);
  if (code !== undefined) data.code = code;
  const message = stringValue(payload.message);
  if (message !== undefined) data.details = message;
  return data;
}

function diagnosticDraft(
  rawType: string,
  sourcePayload: Raw,
  kind: string,
  text: string,
  data: Raw,
): TrailEntryDraft {
  const payload: Raw = { kind, text };
  if (Object.keys(data).length > 0) payload.data = data;
  return {
    type: "system_event",
    payload,
    source: source(rawType, sourcePayload),
    meta: meta(rawType),
  };
}

function messageDiagnostic(payloadType: string, kind: string, severity: string): MappingDef<Raw> {
  const rawType = `event_msg.${payloadType}`;
  return defineMapping<Raw>({
    match: { type: "event_msg", payload: { type: payloadType } },
    emit: (record) => {
      if (!emittable(record)) return [];
      const p = payloadOf(record);
      const text = stringValue(p.message) ?? "Codex diagnostic";
      return [diagnosticDraft(rawType, p, kind, text, diagnosticMessageData(p, severity))];
    },
  });
}

const modelReroute = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "model_reroute" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const from = stringValue(p.from_model) ?? stringValue(p.from);
    const to = stringValue(p.to_model) ?? stringValue(p.to);
    const reason = stringValue(p.reason);
    const data: Raw = {};
    if (from !== undefined) data.from = from;
    if (to !== undefined) data.to = to;
    if (reason !== undefined) data.reason = reason;
    const text =
      from !== undefined && to !== undefined ? `Model rerouted: ${from} → ${to}` : "Model rerouted";
    return [diagnosticDraft("event_msg.model_reroute", p, "model_rerouted", text, data)];
  },
});

const modelVerification = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "model_verification" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const verifications = Array.isArray(p.verifications)
      ? p.verifications.filter((item): item is string => typeof item === "string")
      : [];
    const data: Raw = { reason: "model_verification" };
    if (verifications.length > 0) data.details = verifications;
    return [
      diagnosticDraft(
        "event_msg.model_verification",
        p,
        "model_rerouted",
        "Model verification required",
        data,
      ),
    ];
  },
});

const deprecationNotice = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "deprecation_notice" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const text = stringValue(p.summary) ?? "Deprecation notice";
    const data: Raw = {};
    const details = stringValue(p.details);
    if (details !== undefined) data.details = details;
    return [diagnosticDraft("event_msg.deprecation_notice", p, "deprecation_notice", text, data)];
  },
});

const streamError = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "stream_error" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const text = stringValue(p.message) ?? "Stream error";
    const data: Raw = { severity: "error" };
    const code = diagnosticCode(p);
    if (code !== undefined) data.code = code;
    data.details = stringValue(p.additional_details) ?? text;
    return [diagnosticDraft("event_msg.stream_error", p, "stream_error", text, data)];
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

const threadGoalUpdated = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "thread_goal_updated" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const goal = isObject(p.goal) ? p.goal : undefined;
    if (goal === undefined) return [];
    const summary = stringValue(goal.summary);
    return [
      {
        type: "session_metadata_update",
        payload:
          summary !== undefined && summary.length > 0
            ? { field: "description", value: summary, reason: "ai_generated" }
            : { field: "x-codex/thread_goal", value: goal, reason: "ai_generated" },
        source: source("event_msg.thread_goal_updated"),
        meta: meta("event_msg.thread_goal_updated"),
      },
    ];
  },
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

// Codex 0.135 `turn_aborted` reports an interrupted/cancelled turn — the same
// signal Pi/Claude Code surface as `user_interrupt`. `reason` is observed as
// "interrupted" in real sessions; pass it through.
const turnAborted = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "turn_aborted" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const reason = stringValue(p.reason);
    const metadata = meta("event_msg.turn_aborted");
    const turnId = stringValue(p.turn_id);
    if (turnId !== undefined) metadata.turn_id = turnId;
    const durationMs = numericValue(p.duration_ms);
    if (durationMs !== undefined) metadata.duration_ms = Math.trunc(durationMs);
    const completedAt = numericValue(p.completed_at);
    if (completedAt !== undefined) metadata.completed_at = Math.trunc(completedAt);
    return [
      {
        type: "user_interrupt",
        payload: reason !== undefined ? { reason } : {},
        source: source("event_msg.turn_aborted"),
        meta: metadata,
      },
    ];
  },
});

// Codex 0.135 `item_completed` wraps a completed turn item. Observed real
// sessions carry `item.type: "Plan"` (the agent's task plan) with no item
// statuses. Preserve the whole item under `data.item`; status-bearing
// `update_plan` function calls map separately to `task_plan_update`.
// Other item types reuse this generic capture.
const itemCompleted = lifecycle("item_completed", (p) => {
  const data: Raw = {};
  if (isObject(p.item)) data.item = p.item;
  const turnId = stringValue(p.turn_id);
  if (turnId !== undefined) data.turn_id = turnId;
  const threadId = stringValue(p.thread_id);
  if (threadId !== undefined) data.thread_id = threadId;
  const completedAtMs = numericValue(p.completed_at_ms);
  if (completedAtMs !== undefined) data.completed_at_ms = Math.trunc(completedAtMs);
  return { kind: "x-codex/item_completed", rawType: "event_msg.item_completed", data };
});

// Transient carrier: an image-bearing `response_item.message` maps to a carrier
// system_event holding the attachments + text + role under this meta key.
// `codexImageRollup` folds the attachments into the matching user/agent message
// (whose text is the duplicate `event_msg` echo) and drops the carrier.
export const IMAGE_CARRIER = "x-codex/_images";
export const INLINE_IMAGE_MAX_DECODED_BYTES = 1024 * 1024;

type CarriedImages = { role?: string; text: string; attachments: Attachment[] };

type ParsedDataUri = { mediaType?: string; bytes?: Buffer; oversized?: true };

function parseBase64Image(mediaType: string | undefined, data: string): ParsedDataUri {
  const compact = data.replace(/\s+/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const decodedBytes = Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
  if (decodedBytes > INLINE_IMAGE_MAX_DECODED_BYTES) {
    return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
  }
  return {
    ...(mediaType !== undefined ? { mediaType } : {}),
    bytes: Buffer.from(compact, "base64"),
  };
}

// Pull bytes + media type out of a `data:<media-type>;base64,...` URI.
function parseDataUri(uri: string): ParsedDataUri | undefined {
  const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/s.exec(uri);
  if (match === null) return undefined;
  const [, mediaType, parameters = "", data = ""] = match;
  if (parameters.split(";").includes("base64")) {
    return parseBase64Image(mediaType, data);
  }
  if (data.length > INLINE_IMAGE_MAX_DECODED_BYTES * 3) {
    return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
  }
  try {
    const decoded = decodeURIComponent(data);
    if (Buffer.byteLength(decoded, "utf8") > INLINE_IMAGE_MAX_DECODED_BYTES) {
      return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
    }
    return {
      ...(mediaType !== undefined ? { mediaType } : {}),
      bytes: Buffer.from(decoded, "utf8"),
    };
  } catch {
    if (Buffer.byteLength(data, "utf8") > INLINE_IMAGE_MAX_DECODED_BYTES) {
      return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
    }
    return { ...(mediaType !== undefined ? { mediaType } : {}), bytes: Buffer.from(data, "utf8") };
  }
}

function sha256Ref(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function attachmentRef(uri: string): { mediaType?: string; uri?: string } | undefined {
  if (/^(https:|file:|sha256:)/.test(uri)) return { uri };
  const parsed = parseDataUri(uri);
  if (parsed === undefined) return undefined;
  return {
    ...(parsed.mediaType !== undefined ? { mediaType: parsed.mediaType } : {}),
    ...(parsed.bytes !== undefined ? { uri: sha256Ref(parsed.bytes) } : {}),
  };
}

// Build spec `attachments[]` from a response_item.message content array. Codex
// images appear as `input_image` (Responses API, `image_url` is a data: URI) or
// `image` (`{ source: { media_type, data } }`). Non-image blocks are ignored.
function imageAttachments(content: unknown): Attachment[] {
  if (!Array.isArray(content)) return [];
  const out: Attachment[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    const type = stringValue(block.type);
    if (type !== "input_image" && type !== "image") continue;
    const src = isObject(block.source) ? block.source : undefined;
    const uri = stringValue(block.image_url) ?? stringValue(src?.url);
    let ref = uri !== undefined ? attachmentRef(uri) : undefined;
    let mediaType = ref?.mediaType ?? stringValue(src?.media_type);
    if (ref === undefined && src !== undefined) {
      const mt = mediaType;
      const data = stringValue(src.data);
      const parsed = data !== undefined ? parseBase64Image(mt, data) : undefined;
      if (parsed !== undefined) {
        ref = parsed.bytes !== undefined ? { uri: sha256Ref(parsed.bytes) } : {};
        if (parsed.mediaType !== undefined) mediaType = parsed.mediaType;
      }
    }
    const attachment: Attachment = { kind: "image" };
    if (mediaType !== undefined) attachment.media_type = mediaType;
    if (ref?.uri !== undefined) attachment.uri = ref.uri;
    out.push(attachment);
  }
  return out;
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isObject)
    .map((b) => (/text/.test(String(b.type)) ? (stringValue(b.text) ?? "") : ""))
    .join("");
}

// `response_item.message` is the Responses-API conversation item. Its text
// duplicates the `event_msg.{user,agent}_message` the adapter already emits, so
// text-only ones are suppressed. Image-bearing ones carry content that is NOT in
// the (text-only) event_msg echo, so they map to a transient IMAGE_CARRIER whose
// attachments `codexImageRollup` folds into the matching message.
const responseItemMessage = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "message" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const attachments = imageAttachments(p.content);
    if (attachments.length === 0) return []; // text-only → suppress (duplicate)
    const carried: CarriedImages = {
      attachments,
      text: textFromMessageContent(p.content),
      ...(stringValue(p.role) !== undefined ? { role: stringValue(p.role) } : {}),
    };
    return [
      {
        type: "system_event",
        payload: { kind: IMAGE_CARRIER, text: "" },
        source: source("response_item.message"),
        meta: { [RAW_TYPE]: "response_item.message", [IMAGE_CARRIER]: carried },
      },
    ];
  },
});

function mcpStatusState(status: unknown): string | undefined {
  if (typeof status === "string") return status;
  if (!isObject(status)) return undefined;
  return stringValue(status.state);
}

function mcpStatusError(status: unknown): string | undefined {
  return isObject(status) ? stringValue(status.error) : undefined;
}

const mcpStartupUpdate = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "mcp_startup_update" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const name = stringValue(p.server);
    if (name === undefined) return [];
    const state = mcpStatusState(p.status);
    if (state === "starting") {
      return [
        {
          type: "capability_change",
          payload: { scope: "mcp_server", reason: "loaded", added: [{ name }] },
          source: source("event_msg.mcp_startup_update"),
          meta: meta("event_msg.mcp_startup_update"),
        },
      ];
    }
    if (state === "ready") {
      return [
        {
          type: "capability_change",
          payload: { scope: "mcp_server", reason: "connected", added: [{ name }] },
          source: source("event_msg.mcp_startup_update"),
          meta: meta("event_msg.mcp_startup_update"),
        },
      ];
    }
    if (state === "failed") {
      return [
        {
          type: "capability_change",
          payload: {
            scope: "mcp_server",
            reason: "error",
            changed: [
              {
                name,
                field: "error",
                to: mcpStatusError(p.status) ?? "failed",
              },
            ],
          },
          source: source("event_msg.mcp_startup_update"),
          meta: meta("event_msg.mcp_startup_update"),
        },
      ];
    }
    if (state === "cancelled") {
      return [
        {
          type: "capability_change",
          payload: { scope: "mcp_server", reason: "disconnected", removed: [{ name }] },
          source: source("event_msg.mcp_startup_update"),
          meta: meta("event_msg.mcp_startup_update"),
        },
      ];
    }
    return [];
  },
});

const mcpStartupComplete = defineMapping<Raw>({
  match: { type: "event_msg", payload: { type: "mcp_startup_complete" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const drafts: TrailEntryDraft[] = [];
    const ready = Array.isArray(p.ready)
      ? p.ready.filter((item): item is string => typeof item === "string").map((name) => ({ name }))
      : [];
    if (ready.length > 0) {
      drafts.push({
        type: "capability_change",
        payload: { scope: "mcp_server", reason: "connected", added: ready },
        source: source("event_msg.mcp_startup_complete"),
        meta: meta("event_msg.mcp_startup_complete"),
      });
    }

    const failed = Array.isArray(p.failed)
      ? p.failed.flatMap((item) => {
          if (!isObject(item)) return [];
          const name = stringValue(item.server);
          if (name === undefined) return [];
          return [
            {
              name,
              field: "error",
              to: stringValue(item.error) ?? "failed",
            },
          ];
        })
      : [];
    if (failed.length > 0) {
      drafts.push({
        type: "capability_change",
        payload: { scope: "mcp_server", reason: "error", changed: failed },
        source: source("event_msg.mcp_startup_complete"),
        meta: meta("event_msg.mcp_startup_complete"),
      });
    }

    const cancelled = Array.isArray(p.cancelled)
      ? p.cancelled
          .filter((item): item is string => typeof item === "string")
          .map((name) => ({ name }))
      : [];
    if (cancelled.length > 0) {
      drafts.push({
        type: "capability_change",
        payload: { scope: "mcp_server", reason: "disconnected", removed: cancelled },
        source: source("event_msg.mcp_startup_complete"),
        meta: meta("event_msg.mcp_startup_complete"),
      });
    }

    return drafts;
  },
});

// Intentionally NOT mapped (recognized by the codex/v0.135 schema so they are not
// quarantined, and dropped because they duplicate already-captured records):
//   - response_item.message (text-only) — duplicates event_msg.{user,agent}_message.
//   - event_msg.context_compacted — duplicates the top-level `compacted` record.
export const codexMappings: MappingDef<Raw>[] = [
  sessionDynamicTools,
  message("user_message"),
  message("agent_message"),
  responseItemMessage,
  functionCall,
  toolResult("function_call_output"),
  customToolCall,
  toolResult("custom_tool_call_output"),
  webSearchCall,
  toolSearchCall,
  toolSearchOutput,
  compacted,
  tokenCount,
  messageDiagnostic("error", "agent_error", "error"),
  messageDiagnostic("warning", "agent_warning", "warning"),
  messageDiagnostic("guardian_warning", "guardian_alert", "warning"),
  modelReroute,
  modelVerification,
  deprecationNotice,
  streamError,
  taskStarted,
  taskCompleted,
  execCommandEnd,
  patchApplyEnd,
  mcpToolCallEnd,
  threadGoalUpdated,
  webSearchEnd,
  turnAborted,
  itemCompleted,
  mcpStartupUpdate,
  mcpStartupComplete,
];
