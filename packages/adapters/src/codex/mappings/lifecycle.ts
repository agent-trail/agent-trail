import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { isNonEmptyString } from "../../task-plan.ts";
import { buildExecCommandEndData, durationToMs, excerpt } from "../parser.ts";
import { isObject, numericValue, stringValue } from "../source.ts";
import { emittable, meta, payloadOf, type Raw, source } from "./shared.ts";

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

function copyString(data: Raw, p: Raw, key: string, outKey = key): void {
  const value = stringValue(p[key]);
  if (value !== undefined) data[outKey] = value;
}

function copyTruncatedNumber(data: Raw, p: Raw, key: string, outKey = key): void {
  const value = numericValue(p[key]);
  if (value !== undefined) data[outKey] = Math.trunc(value);
}

function copyNumber(data: Raw, p: Raw, key: string, outKey = key): void {
  const value = numericValue(p[key]);
  if (value !== undefined) data[outKey] = value;
}

function copyBooleanOrNumber(data: Raw, p: Raw, key: string, outKey = key): void {
  const value = p[key];
  if (typeof value === "boolean") data[outKey] = value;
  else copyNumber(data, p, key, outKey);
}

function copyObject(data: Raw, p: Raw, key: string, outKey = key): void {
  if (isObject(p[key])) data[outKey] = p[key];
}

function copyObjectOrArray(data: Raw, p: Raw, key: string, outKey = key): void {
  const value = p[key];
  if (isObject(value) || Array.isArray(value)) data[outKey] = value;
}

function copyArray(data: Raw, p: Raw, key: string, outKey = key): void {
  if (Array.isArray(p[key])) data[outKey] = p[key];
}

function copyStringArray(data: Raw, p: Raw, key: string, outKey = key): void {
  const value = p[key];
  if (!Array.isArray(value)) return;
  const strings = value.filter((item): item is string => typeof item === "string");
  if (strings.length === value.length) data[outKey] = strings;
}

function copySchemaType(data: Raw, p: Raw): void {
  const value = p.type;
  if (typeof value === "string") data.type = value;
  else if (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    data.type = value;
  }
}

function sanitizedSchema(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const out: Raw = {};
  copySchemaType(out, value);
  copyString(out, value, "format");
  copyString(out, value, "$ref");
  copyString(out, value, "pattern");
  copyStringArray(out, value, "required");
  for (const key of [
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
    "multipleOf",
  ] as const) {
    copyNumber(out, value, key);
  }
  copyBooleanOrNumber(out, value, "exclusiveMinimum");
  copyBooleanOrNumber(out, value, "exclusiveMaximum");

  if (isObject(value.properties)) {
    const properties: Raw = {};
    for (const [name, property] of Object.entries(value.properties)) {
      const sanitized = sanitizedSchema(property);
      properties[name] = sanitized ?? {};
    }
    if (Object.keys(properties).length > 0) out.properties = properties;
  }

  const items = sanitizedSchema(value.items);
  if (items !== undefined) out.items = items;

  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    const variants = value[key];
    if (!Array.isArray(variants)) continue;
    const sanitized = variants
      .map((variant) => sanitizedSchema(variant))
      .filter((variant): variant is Raw => variant !== undefined);
    if (sanitized.length > 0) out[key] = sanitized;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizedUrlData(rawUrl: string): Raw | undefined {
  try {
    const url = new URL(rawUrl);
    return {
      url_origin: url.origin,
      url_host: url.host,
    };
  } catch {
    return { has_url: true };
  }
}

function sanitizedElicitationRequest(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const out: Raw = {};
  copyString(out, value, "mode");
  copyString(out, value, "type");
  copyString(out, value, "action");

  const elicitationId =
    stringValue(value.elicitation_id) ??
    stringValue(value.elicitationId) ??
    stringValue(value.request_id) ??
    stringValue(value.requestId);
  if (elicitationId !== undefined) out.elicitation_id = elicitationId;

  const urlData = stringValue(value.url);
  if (urlData !== undefined) Object.assign(out, sanitizedUrlData(urlData));

  const schema =
    sanitizedSchema(value.requestedSchema) ??
    sanitizedSchema(value.requested_schema) ??
    sanitizedSchema(value.schema);
  if (schema !== undefined) out.schema = schema;

  return Object.keys(out).length > 0 ? out : undefined;
}

function permissionRequestBaseData(p: Raw): { data: Raw; callId?: string } {
  const data: Raw = {};
  const rawCallId = stringValue(p.call_id);
  const callId = isNonEmptyString(rawCallId) ? rawCallId : undefined;
  if (callId !== undefined) data.tool_call_id = callId;
  copyString(data, p, "turn_id");
  copyTruncatedNumber(data, p, "started_at_ms");
  copyString(data, p, "reason");
  return { data, callId };
}

function hookRunData(value: unknown): Raw | undefined {
  if (!isObject(value)) return undefined;
  const data: Raw = {};
  copyString(data, value, "id");
  copyString(data, value, "event_name");
  copyString(data, value, "handler_type");
  copyString(data, value, "execution_mode");
  copyString(data, value, "scope");
  copyString(data, value, "source_path");
  copyString(data, value, "source");
  copyTruncatedNumber(data, value, "display_order");
  copyString(data, value, "status");
  copyString(data, value, "status_message");
  copyTruncatedNumber(data, value, "started_at");
  copyTruncatedNumber(data, value, "completed_at");
  copyTruncatedNumber(data, value, "duration_ms");
  const entries = hookRunEntries(value.entries);
  if (entries !== undefined) data.entries = entries;
  return Object.keys(data).length > 0 ? data : undefined;
}

function hookRunEntries(value: unknown): Raw[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const out: Raw = {};
    copyString(out, entry, "stream");
    copyString(out, entry, "type");
    copyString(out, entry, "level");
    const text = excerpt(stringValue(entry.text));
    if (text !== undefined) out.text = text;
    return Object.keys(out).length > 0 ? [out] : [];
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

const itemStarted = lifecycle("item_started", (p) => {
  const data: Raw = {};
  copyString(data, p, "thread_id");
  copyString(data, p, "turn_id");
  copyTruncatedNumber(data, p, "started_at_ms");
  copyObject(data, p, "item");
  return { kind: "x-codex/item_started", rawType: "event_msg.item_started", data };
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

function hookLifecycle(payloadType: "hook_started" | "hook_completed"): MappingDef<Raw> {
  const rawType = `event_msg.${payloadType}`;
  return lifecycle(payloadType, (p) => {
    const data: Raw = {};
    copyString(data, p, "turn_id");
    const run = hookRunData(p.run);
    if (run !== undefined) data.run = run;
    return { kind: "hook_fired", rawType, data };
  });
}

const hookStarted = hookLifecycle("hook_started");
const hookCompleted = hookLifecycle("hook_completed");

const execCommandEnd = lifecycle("exec_command_end", (p) => ({
  kind: "x-codex/exec_command_end",
  rawType: "event_msg.exec_command_end",
  data: buildExecCommandEndData(p),
  linkedCallId: stringValue(p.call_id),
}));

const execCommandBegin = lifecycle("exec_command_begin", (p) => {
  const data: Raw = {};
  copyString(data, p, "call_id");
  copyString(data, p, "turn_id");
  copyString(data, p, "process_id");
  copyTruncatedNumber(data, p, "started_at_ms");
  copyArray(data, p, "command");
  copyString(data, p, "cwd");
  copyArray(data, p, "parsed_cmd");
  copyString(data, p, "source");
  const interactionInput = stringValue(p.interaction_input);
  if (interactionInput !== undefined) {
    data.has_interaction_input = true;
    data.interaction_input_chars = interactionInput.length;
  }
  return {
    kind: "x-codex/exec_command_begin",
    rawType: "event_msg.exec_command_begin",
    data,
    linkedCallId: stringValue(p.call_id),
  };
});

const execApprovalRequest = lifecycle("exec_approval_request", (p) => {
  const { data, callId } = permissionRequestBaseData(p);
  copyString(data, p, "approval_id");
  copyArray(data, p, "command");
  copyString(data, p, "cwd");
  copyObject(data, p, "network_approval_context");
  copyObjectOrArray(data, p, "proposed_execpolicy_amendment");
  copyArray(data, p, "proposed_network_policy_amendments");
  copyObject(data, p, "additional_permissions");
  copyArray(data, p, "available_decisions");
  copyArray(data, p, "parsed_cmd");
  return {
    kind: "permission_request",
    rawType: "event_msg.exec_approval_request",
    data,
    linkedCallId: callId,
  };
});

const requestPermissions = lifecycle("request_permissions", (p) => {
  const { data, callId } = permissionRequestBaseData(p);
  copyObject(data, p, "permissions");
  copyString(data, p, "cwd");
  return {
    kind: "permission_request",
    rawType: "event_msg.request_permissions",
    data,
    linkedCallId: callId,
  };
});

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

const patchApplyBegin = lifecycle("patch_apply_begin", (p) => {
  const data: Raw = {};
  copyString(data, p, "call_id");
  copyString(data, p, "turn_id");
  if (typeof p.auto_approved === "boolean") data.auto_approved = p.auto_approved;
  copyObject(data, p, "changes");
  return {
    kind: "x-codex/patch_apply_begin",
    rawType: "event_msg.patch_apply_begin",
    data,
    linkedCallId: stringValue(p.call_id),
  };
});

const patchApplyUpdated = lifecycle("patch_apply_updated", (p) => {
  const data: Raw = {};
  copyString(data, p, "call_id");
  copyString(data, p, "turn_id");
  if (typeof p.auto_approved === "boolean") data.auto_approved = p.auto_approved;
  copyObject(data, p, "changes");
  return {
    kind: "x-codex/patch_apply_updated",
    rawType: "event_msg.patch_apply_updated",
    data,
    linkedCallId: stringValue(p.call_id),
  };
});

const applyPatchApprovalRequest = lifecycle("apply_patch_approval_request", (p) => {
  const { data, callId } = permissionRequestBaseData(p);
  copyObject(data, p, "changes");
  copyString(data, p, "grant_root");
  return {
    kind: "permission_request",
    rawType: "event_msg.apply_patch_approval_request",
    data,
    linkedCallId: callId,
  };
});

const elicitationRequest = lifecycle("elicitation_request", (p) => {
  const { data, callId } = permissionRequestBaseData(p);
  const requestId = p.request_id ?? p.id;
  if (typeof requestId === "string" || typeof requestId === "number") {
    data.request_id = requestId;
  }
  copyString(data, p, "server_name");
  copyString(data, p, "prompt");
  const request = sanitizedElicitationRequest(p.request);
  if (request !== undefined) data.request = request;
  copyArray(data, p, "available_decisions");
  return {
    kind: "permission_request",
    rawType: "event_msg.elicitation_request",
    data,
    linkedCallId: callId,
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

const mcpToolCallBegin = lifecycle("mcp_tool_call_begin", (p) => {
  const data: Raw = {};
  copyString(data, p, "call_id");
  copyString(data, p, "plugin_id");
  copyObject(data, p, "invocation");
  copyString(data, p, "mcp_app_resource_uri");
  return {
    kind: "x-codex/mcp_tool_call_begin",
    rawType: "event_msg.mcp_tool_call_begin",
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

const webSearchBegin = lifecycle("web_search_begin", (p) => {
  const data: Raw = {};
  copyString(data, p, "call_id");
  return {
    kind: "x-codex/web_search_begin",
    rawType: "event_msg.web_search_begin",
    data,
  };
});

const imageGenerationBegin = lifecycle("image_generation_begin", (p) => {
  const data: Raw = {};
  copyString(data, p, "call_id");
  return {
    kind: "x-codex/image_generation_begin",
    rawType: "event_msg.image_generation_begin",
    data,
  };
});

const imageGenerationEnd = lifecycle("image_generation_end", (p) => {
  const data: Raw = {};
  copyString(data, p, "call_id");
  copyString(data, p, "status");
  copyString(data, p, "revised_prompt");
  copyString(data, p, "result");
  copyString(data, p, "saved_path");
  return {
    kind: "x-codex/image_generation_end",
    rawType: "event_msg.image_generation_end",
    data,
  };
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

export const lifecycleMappings: MappingDef<Raw>[] = [
  taskStarted,
  itemStarted,
  taskCompleted,
  hookStarted,
  hookCompleted,
  execCommandBegin,
  execCommandEnd,
  execApprovalRequest,
  requestPermissions,
  patchApplyBegin,
  patchApplyUpdated,
  patchApplyEnd,
  applyPatchApprovalRequest,
  elicitationRequest,
  mcpToolCallBegin,
  mcpToolCallEnd,
  threadGoalUpdated,
  webSearchBegin,
  webSearchEnd,
  imageGenerationBegin,
  imageGenerationEnd,
  turnAborted,
  itemCompleted,
];
