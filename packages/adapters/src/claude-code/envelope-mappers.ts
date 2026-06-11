import { type CcEnvelope, jsonObjectValue, stringValue } from "./source.ts";

export function systemEventText(envelope: CcEnvelope): string {
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
  if (envelope.type === "pr-link") {
    const num = envelope.prNumber;
    const url = stringValue(envelope.prUrl);
    if (typeof num === "number" && url !== undefined) return `PR #${num}: ${url}`;
    if (url !== undefined) return url;
    return "PR link";
  }
  return "System event";
}

export function isSessionEndHookEvent(hookEvent: string | undefined): boolean {
  return hookEvent === "SessionEnd";
}

// Maps Claude Code hook lifecycle events to reserved system_event kinds (spec §9.3).
// Unrecognized hookEvent values fall back to `hook_fired` so timelines surface them.
// SessionEnd maps to the first-class session_end event, not system_event.kind.
export function hookEventToKind(hookEvent: string | undefined): string {
  switch (hookEvent) {
    case "SessionStart":
      return "session_start";
    case "Stop":
      return "turn_end";
    case "SubagentStop":
      return "subagent_end";
    case "PreToolUse":
      return "pre_tool_use";
    case "PostToolUse":
      return "post_tool_use";
    case "Notification":
      return "permission_request";
    default:
      return "hook_fired";
  }
}

const SYSTEM_SUBTYPE_PATTERN = /^[a-z0-9][a-z0-9_]*$/;

// Maps Claude Code `system` envelope subtypes to reserved or vendor-namespaced kinds.
// stop_hook_summary marks the turn boundary; turn_duration is duration-only metadata
// retained as a vendor extension. compact_boundary is preserved under x-claudecode
// because the canonical context_compact entry is produced by the summary envelope.
function systemSubtypeToKind(subtype: string | undefined): string {
  switch (subtype) {
    case "stop_hook_summary":
      return "turn_end";
    case "turn_duration":
      return "x-claudecode/turn_duration";
    case "compact_boundary":
      return "x-claudecode/compact_boundary";
    case "api_error":
      return "api_error";
    case "away_summary":
      return "x-claudecode/away_summary";
    case "local_command":
      return "x-claudecode/local_command";
    case "bridge_status":
      return "x-claudecode/bridge_status";
    default:
      return subtype !== undefined && SYSTEM_SUBTYPE_PATTERN.test(subtype)
        ? `x-claudecode/${subtype}`
        : "x-claudecode/system";
  }
}

export function systemEventKind(envelope: CcEnvelope): string {
  if (envelope.type === "queue-operation") return "queue_operation";
  if (envelope.type === "pr-link") return "x-claudecode/pr_link";
  if (envelope.type === "progress") {
    const data = jsonObjectValue(envelope.data);
    if (stringValue(data?.type) === "hook_progress") {
      return hookEventToKind(stringValue(data?.hookEvent));
    }
    return "x-claudecode/progress";
  }
  return systemSubtypeToKind(stringValue(envelope.subtype));
}

export function systemEventData(envelope: CcEnvelope): Record<string, unknown> | undefined {
  if (envelope.type === "progress") return jsonObjectValue(envelope.data);
  if (envelope.type === "system" && stringValue(envelope.subtype) === "api_error") {
    const content = stringValue(envelope.content);
    return {
      severity: "error",
      ...(content !== undefined ? { details: content } : {}),
    };
  }
  if (envelope.type === "pr-link") {
    const out: Record<string, unknown> = {};
    if (typeof envelope.prNumber === "number") out.pr_number = envelope.prNumber;
    const url = stringValue(envelope.prUrl);
    if (url !== undefined) out.pr_url = url;
    const repo = stringValue(envelope.prRepository);
    if (repo !== undefined) out.pr_repository = repo;
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}
