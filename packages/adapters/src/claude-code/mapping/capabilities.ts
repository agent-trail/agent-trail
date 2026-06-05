import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { isNonEmptyString } from "../../task-plan.ts";
import { hookEventToKind } from "../envelope-mappers.ts";
import { type CcEnvelope, isObject, jsonString, stringValue } from "../source.ts";
import {
  gate,
  hookAdditionalContextContent,
  hookFailureDraft,
  meta,
  type Raw,
  src,
} from "./shared.ts";

type CapabilityItem = { name: string; metadata?: Record<string, unknown> };

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function permissionDecision(value: unknown): "allow" | "deny" | undefined {
  const normalized = stringValue(value)?.toLowerCase();
  if (normalized === "allow" || normalized === "allowed" || normalized === "approved") {
    return "allow";
  }
  if (
    normalized === "deny" ||
    normalized === "denied" ||
    normalized === "reject" ||
    normalized === "rejected"
  ) {
    return "deny";
  }
  return undefined;
}

function skillMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const description = stringValue(value.description);
  return description === undefined ? undefined : { description };
}

function skillItems(attachment: Record<string, unknown>): CapabilityItem[] {
  const skills = Array.isArray(attachment.skills) ? attachment.skills : undefined;
  if (skills !== undefined) {
    return skills.flatMap((skill) => {
      if (typeof skill === "string") return [{ name: skill }];
      if (!isObject(skill)) return [];
      const name = stringValue(skill.name);
      if (name === undefined) return [];
      const metadata = skillMetadata(skill);
      return [{ name, ...(metadata !== undefined ? { metadata } : {}) }];
    });
  }

  return stringArray(attachment.skillNames ?? attachment.names).map((name) => ({ name }));
}

function listingText(attachment: Record<string, unknown>): string | undefined {
  const content = attachment.content ?? attachment.text;
  if (content === undefined) return undefined;
  if (typeof content === "string") return content;
  return jsonString(content);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hookSuccessText(hookEvent: string | undefined, hookName: string | undefined): string {
  const event = hookEvent ?? "hook";
  return hookName?.trim() ? `Hook success: ${event} (${hookName})` : `Hook success: ${event}`;
}

const OUTPUT_EXCERPT_MAX_CHARS = 2048;
function outputExcerpt(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= OUTPUT_EXCERPT_MAX_CHARS) return text;
  return `${text.slice(0, OUTPUT_EXCERPT_MAX_CHARS)}…`;
}

function hookSuccessSourceRecord(
  record: CcEnvelope,
  attachment: Record<string, unknown>,
  isLegacyAttachment: boolean,
): CcEnvelope {
  const sanitizedAttachment = hookSuccessSourceAttachment(attachment);
  if (isLegacyAttachment) return { ...record, attachment: sanitizedAttachment };
  return { ...record, ...sanitizedAttachment };
}

function hookSuccessSourceAttachment(attachment: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...attachment };
  summarizeHookOutput(out, "stdout");
  summarizeHookOutput(out, "stderr");
  return out;
}

function summarizeHookOutput(out: Record<string, unknown>, key: "stdout" | "stderr"): void {
  const value = stringValue(out[key]);
  if (value === undefined) return;
  delete out[key];
  out[`${key}_elided`] = true;
  out[`${key}_chars`] = value.length;
}

function hookToolCallId(attachment: Record<string, unknown>): string | undefined {
  const rawToolCallId =
    stringValue(attachment.tool_call_id) ??
    stringValue(attachment.toolCallId) ??
    stringValue(attachment.tool_use_id) ??
    stringValue(attachment.toolUseID);
  return isNonEmptyString(rawToolCallId) ? rawToolCallId.trim() : undefined;
}

function hookSuccessData(attachment: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const hookEvent = stringValue(attachment.hook_event) ?? stringValue(attachment.hookEvent);
  if (hookEvent !== undefined) data.hook_event = hookEvent;
  const hookName = stringValue(attachment.hook_name) ?? stringValue(attachment.hookName);
  if (hookName !== undefined) data.hook_name = hookName;
  const toolCallId = hookToolCallId(attachment);
  if (toolCallId !== undefined) data.tool_call_id = toolCallId;
  const exitCode = numberValue(attachment.exit_code) ?? numberValue(attachment.exitCode);
  if (exitCode !== undefined) data.exit_code = Math.trunc(exitCode);
  const durationMs = numberValue(attachment.duration_ms) ?? numberValue(attachment.durationMs);
  if (durationMs !== undefined) data.duration_ms = Math.trunc(durationMs);
  const command = stringValue(attachment.command);
  if (command !== undefined) data.command = command;
  const stdout = outputExcerpt(stringValue(attachment.stdout));
  if (stdout !== undefined) data.stdout_excerpt = stdout;
  const stderr = outputExcerpt(stringValue(attachment.stderr));
  if (stderr !== undefined) data.stderr_excerpt = stderr;
  return data;
}

function emitCapabilityAttachment(record: CcEnvelope): TrailEntryDraft[] {
  if (!gate(record)) return [];
  const isLegacyAttachment = record.type === "attachment";
  const attachment = isLegacyAttachment && isObject(record.attachment) ? record.attachment : record;
  const subtype = isLegacyAttachment ? stringValue(attachment.type) : stringValue(record.type);
  if (subtype === undefined) return [];
  const originalType = isLegacyAttachment ? `attachment.${subtype}` : subtype;

  if (subtype === "hook_blocking_error") {
    const toolCallId = hookToolCallId(attachment);
    if (toolCallId !== undefined) {
      const hookName = stringValue(attachment.hook_name) ?? stringValue(attachment.hookName);
      return [
        {
          type: "tool_call_aborted",
          payload: {
            scope: "tool_call",
            reason: "hook_blocked",
            ...(hookName !== undefined ? { blocked_by: hookName } : {}),
          },
          source: src(record, originalType),
          meta: meta(record, { callId: toolCallId }),
        },
      ];
    }
    return [
      hookFailureDraft(record, originalType, attachment, {
        fallbackBlocking: true,
      }),
    ];
  }

  if (subtype === "hook_non_blocking_error") {
    return [
      hookFailureDraft(record, originalType, attachment, {
        fallbackBlocking: false,
      }),
    ];
  }

  if (subtype === "deferred_tools_delta") {
    const drafts: TrailEntryDraft[] = [];
    const added = stringArray(attachment.addedNames ?? attachment.added_names).map((name) => ({
      name,
    }));
    if (added.length > 0) {
      drafts.push({
        type: "capability_change",
        payload: { scope: "tool", reason: "registered", added },
        source: src(record, originalType),
        meta: meta(record),
      });
    }
    const removed = stringArray(attachment.removedNames ?? attachment.removed_names).map(
      (name) => ({ name }),
    );
    if (removed.length > 0) {
      drafts.push({
        type: "capability_change",
        payload: { scope: "tool", reason: "deregistered", removed },
        source: src(record, originalType),
        meta: meta(record),
      });
    }
    return drafts;
  }

  if (subtype === "skill_listing") {
    const snapshot = skillItems(attachment);
    if (snapshot.length > 0) {
      return [
        {
          type: "capability_change",
          payload: { scope: "skill", reason: "loaded", snapshot },
          source: src(record, originalType),
          meta: meta(record),
        },
      ];
    }
    const text = listingText(attachment);
    if (text === undefined || text.length === 0) return [];
    return [
      {
        type: "capability_change",
        payload: {
          scope: "skill",
          reason: "loaded",
          changed: [{ name: "skill_listing", field: "listing", to: text }],
        },
        source: src(record, originalType),
        meta: meta(record),
      },
    ];
  }

  if (subtype === "mcp_instructions_delta") {
    const name =
      stringValue(attachment.serverName) ??
      stringValue(attachment.server) ??
      stringValue(attachment.name) ??
      "mcp_instructions";
    const content = listingText(attachment);
    return [
      {
        type: "capability_change",
        payload: {
          scope: "mcp_server",
          reason: "instructions_updated",
          changed: [
            {
              name,
              field: "instructions",
              ...(content !== undefined && content.length > 0 ? { to: content } : {}),
            },
          ],
        },
        source: src(record, originalType),
        meta: meta(record),
      },
    ];
  }

  if (subtype === "hook_success") {
    const hookEvent = stringValue(attachment.hook_event) ?? stringValue(attachment.hookEvent);
    const hookName = stringValue(attachment.hook_name) ?? stringValue(attachment.hookName);
    const toolCallId = hookToolCallId(attachment);
    return [
      {
        type: "system_event",
        payload: {
          kind: hookEventToKind(hookEvent),
          text: hookSuccessText(hookEvent, hookName),
          data: hookSuccessData(attachment),
        },
        ...(toolCallId !== undefined ? { semantic: { call_id: toolCallId } } : {}),
        source: src(hookSuccessSourceRecord(record, attachment, isLegacyAttachment), originalType),
        meta: meta(record, { callId: toolCallId }),
      },
    ];
  }

  if (subtype === "hook_permission_decision") {
    const decision = permissionDecision(attachment.decision);
    if (decision === undefined) return [];
    const data: Record<string, unknown> = { decision };
    const toolCallId = hookToolCallId(attachment);
    if (toolCallId !== undefined) data.tool_call_id = toolCallId;
    const hookEvent = stringValue(attachment.hook_event) ?? stringValue(attachment.hookEvent);
    if (hookEvent !== undefined) data.hook_event = hookEvent;
    const capability = stringValue(attachment.capability);
    if (capability !== undefined) data.capability = capability;
    return [
      {
        type: "system_event",
        payload: {
          kind: "permission_decision",
          data,
        },
        ...(toolCallId !== undefined ? { semantic: { call_id: toolCallId } } : {}),
        source: src(record, originalType),
        meta: meta(record, { callId: toolCallId }),
      },
    ];
  }

  if (subtype === "hook_additional_context") {
    // Text a hook injects into the user turn — input the model actually
    // received. Represented as a system_event (not user_message) so it is not
    // misattributed as user-typed. See issue #126.
    const hookEvent = stringValue(attachment.hook_event) ?? stringValue(attachment.hookEvent);
    const hookName = stringValue(attachment.hook_name) ?? stringValue(attachment.hookName);
    const toolCallId = hookToolCallId(attachment);
    const content = attachment.content;
    const data: Record<string, unknown> = {};
    if (hookEvent !== undefined) data.hook_event = hookEvent;
    if (hookName !== undefined) data.hook_name = hookName;
    if (toolCallId !== undefined) data.tool_call_id = toolCallId;
    const safeContent = hookAdditionalContextContent(content);
    if (safeContent.content !== undefined) data.content = safeContent.content;
    if (safeContent.attachments !== undefined) data.attachments = safeContent.attachments;
    return [
      {
        type: "system_event",
        payload: {
          kind: "x-claudecode/hook_additional_context",
          ...(safeContent.text !== undefined && safeContent.text.length > 0
            ? { text: safeContent.text }
            : {}),
          ...(Object.keys(data).length > 0 ? { data } : {}),
        },
        ...(toolCallId !== undefined ? { semantic: { call_id: toolCallId } } : {}),
        source: src(record, originalType),
        meta: meta(record, { callId: toolCallId }),
      },
    ];
  }

  if (subtype === "command_permissions") {
    const data: Record<string, unknown> = {};
    const rawAllowedTools = attachment.allowed_tools ?? attachment.allowedTools;
    if (Array.isArray(rawAllowedTools)) data.allowed_tools = stringArray(rawAllowedTools);
    const model = stringValue(attachment.model);
    if (model !== undefined) data.model = model;
    if (Object.keys(data).length === 0) return [];
    return [
      {
        type: "system_event",
        payload: {
          kind: "permission_request",
          data,
        },
        source: src(record, originalType),
        meta: meta(record),
      },
    ];
  }

  return [];
}

const capabilityAttachment = defineMapping<Raw>({
  match: { type: "attachment" },
  emit: (raw) => emitCapabilityAttachment(raw as CcEnvelope),
});

const topLevelCommandPermissions = defineMapping<Raw>({
  match: { type: "command_permissions" },
  emit: (raw) => emitCapabilityAttachment(raw as CcEnvelope),
});

const topLevelHookPermissionDecision = defineMapping<Raw>({
  match: { type: "hook_permission_decision" },
  emit: (raw) => emitCapabilityAttachment(raw as CcEnvelope),
});

export const capabilityMappings: MappingDef<Raw>[] = [
  capabilityAttachment,
  topLevelCommandPermissions,
  topLevelHookPermissionDecision,
];
