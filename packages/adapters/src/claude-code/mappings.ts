import { createHash } from "node:crypto";
import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping, mapAgentMessageUsage } from "@agent-trail/adapter-kit";
import type { Entry, ToolKind } from "@agent-trail/types";
import {
  isNonEmptyString,
  isTaskPlanStatus,
  normalizeTaskPlanContent,
  type TaskPlanItem,
  taskPlanItemId,
} from "../task-plan.ts";
import { sourceFor } from "./entry-metadata.ts";
import {
  hookEventToKind,
  systemEventData,
  systemEventKind,
  systemEventText,
} from "./envelope-mappers.ts";
import {
  asBlocks,
  type CcBlock,
  type CcEnvelope,
  isContinuationPreamble,
  isInterruptMarker,
  isObject,
  jsonObjectValue,
  jsonString,
  stringValue,
  textFromToolResultContent,
} from "./source.ts";
import { toolKindAndArgs } from "./tools.ts";

type Raw = Record<string, unknown>;
type UserQueryOption = { label: string; description?: string };

/**
 * Transient hint stashed on `meta`: source uuid (`sid`, for multi-block
 * envelope_ref backfill + model grouping) and the source assistant `model` (for
 * the synthesized model_change rule). Stripped by ccEnvelopeRefBackfill before
 * output — v1 Claude Code entries carry no entry-level meta.
 */
export const HINT = "x-claudecode/_h";
export const INCLUDE_SIDECHAIN = Symbol.for("agent-trail.claude-code.include-sidechain");

export interface CcHint {
  sid?: string;
  model?: string;
}

function meta(
  record: CcEnvelope,
  opts?: { model?: string; callId?: string },
): Record<string, unknown> {
  const hint: CcHint = {
    ...(typeof record.uuid === "string" ? { sid: record.uuid } : {}),
    ...(opts?.model !== undefined ? { model: opts.model } : {}),
  };
  return {
    ...(opts?.callId !== undefined ? { linker: { call_id: opts.callId } } : {}),
    [HINT]: hint,
  };
}

function questionId(question: string, occurrence: number): string {
  const base = `q_${createHash("sha256").update(question).digest("hex").slice(0, 12)}`;
  return occurrence === 0 ? base : `${base}_${occurrence + 1}`;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionObjects(value: unknown): UserQueryOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value
    .map((option) => {
      if (typeof option === "string") return { label: option };
      if (option === null || typeof option !== "object") return undefined;
      const label = stringValue((option as { label?: unknown }).label);
      if (label === undefined) return undefined;
      const description = stringValue((option as { description?: unknown }).description);
      return { label, ...(description !== undefined ? { description } : {}) };
    })
    .filter((option): option is UserQueryOption => option !== undefined);
  return options.length === value.length ? options : undefined;
}

function userQueryQuestion(
  raw: Record<string, unknown>,
  fallbackOccurrence: number,
): Record<string, unknown> | undefined {
  const question = stringValue(raw.question);
  if (question === undefined) return undefined;
  const out: Record<string, unknown> = {
    id: stringValue(raw.id) ?? questionId(question, fallbackOccurrence),
    question,
  };
  const header = stringValue(raw.header);
  if (header !== undefined) out.header = header;
  const multiSelect = booleanValue(raw.multi_select) ?? booleanValue(raw.multiSelect);
  if (multiSelect !== undefined) out.multi_select = multiSelect;
  const isSecret = booleanValue(raw.is_secret) ?? booleanValue(raw.isSecret);
  if (isSecret !== undefined) out.is_secret = isSecret;
  const allowOther =
    booleanValue(raw.allow_other) ?? booleanValue(raw.allowOther) ?? booleanValue(raw.is_other);
  if (allowOther !== undefined) out.allow_other = allowOther;
  const options = optionObjects(raw.options) ?? optionObjects(raw.choices);
  if (options !== undefined) out.options = options;
  return out;
}

function userQueryPayload(input: unknown): { questions: Record<string, unknown>[] } | undefined {
  const args =
    input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (Array.isArray(args.questions)) {
    const occurrences = new Map<string, number>();
    const questions = args.questions
      .filter(
        (question): question is Record<string, unknown> =>
          question !== null && typeof question === "object",
      )
      .map((question) => {
        const text = stringValue(question.question);
        const occurrence = text === undefined ? 0 : (occurrences.get(text) ?? 0);
        if (text !== undefined) occurrences.set(text, occurrence + 1);
        return userQueryQuestion(question, occurrence);
      })
      .filter((question): question is Record<string, unknown> => question !== undefined);
    if (questions.length > 0) return { questions };
  }
  const question = userQueryQuestion(args, 0);
  return question !== undefined ? { questions: [question] } : undefined;
}

function src(
  record: CcEnvelope,
  originalType: string,
  block?: CcBlock,
  blockIndex?: number,
  options?: { synthesized?: boolean; envelopeRef?: string },
): Entry["source"] {
  return sourceFor(record, originalType, block, blockIndex, options);
}

// Mirrors v1 buildEntries gate: drop sidechain/meta envelopes and records
// without a timestamp; require a uuid except where v1 synthesizes one.
function gate(record: CcEnvelope, allowNoUuid = false): boolean {
  const includeSidechain =
    (record as { [INCLUDE_SIDECHAIN]?: boolean })[INCLUDE_SIDECHAIN] === true;
  if ((record.isSidechain === true && !includeSidechain) || record.isMeta === true) return false;
  if (typeof record.timestamp !== "string") return false;
  if (!allowNoUuid && typeof record.uuid !== "string") return false;
  return true;
}

function metadataSource(record: CcEnvelope, originalType: string): Entry["source"] {
  return src(
    record,
    originalType,
    undefined,
    undefined,
    typeof record.uuid !== "string" ? { synthesized: true } : undefined,
  );
}

function hookFailureData(
  raw: Record<string, unknown>,
  fallbackBlocking?: boolean,
): { text: string; data: Record<string, unknown> } {
  const hookName = stringValue(raw.hookName) ?? stringValue(raw.hook_name) ?? stringValue(raw.name);
  const details =
    stringValue(raw.message) ??
    stringValue(raw.error) ??
    stringValue(raw.details) ??
    stringValue(raw.stderr);
  const code =
    stringValue(raw.code) ?? (typeof raw.code === "number" ? String(raw.code) : undefined);
  const blocking = booleanValue(raw.blocking) ?? fallbackBlocking;
  const data: Record<string, unknown> = { severity: "error" };
  if (blocking !== undefined) data.blocking = blocking;
  if (hookName !== undefined) data.hook_name = hookName;
  if (code !== undefined) data.code = code;
  if (details !== undefined) data.details = details;
  return {
    text: hookName !== undefined ? `Hook failed: ${hookName}` : "Hook failed",
    data,
  };
}

function hookFailureDraft(
  record: CcEnvelope,
  originalType: string,
  raw: Record<string, unknown>,
  options?: { fallbackBlocking?: boolean; sourceBlock?: CcBlock; sourceBlockIndex?: number },
): TrailEntryDraft {
  const { text, data } = hookFailureData(raw, options?.fallbackBlocking);
  return {
    type: "system_event",
    payload: { kind: "hook_failed", text, data },
    source: src(record, originalType, options?.sourceBlock, options?.sourceBlockIndex),
    meta: meta(record),
  };
}

function taskPlanItemsFromTodoWrite(input: unknown): TaskPlanItem[] | undefined {
  const args = jsonObjectValue(input) ?? {};
  if (!Array.isArray(args.todos)) return undefined;
  const items: TaskPlanItem[] = [];
  const occurrenceByContent = new Map<string, number>();
  for (const rawTodo of args.todos) {
    if (!isObject(rawTodo)) return undefined;
    const content = stringValue(rawTodo.content);
    const status = rawTodo.status;
    if (content === undefined || !isTaskPlanStatus(status)) return undefined;
    const normalized = normalizeTaskPlanContent(content);
    const occurrence = occurrenceByContent.get(normalized) ?? 0;
    occurrenceByContent.set(normalized, occurrence + 1);
    const activeForm = stringValue(rawTodo.activeForm) ?? stringValue(rawTodo.active_form);
    items.push({
      id: taskPlanItemId(rawTodo.id, occurrence, content),
      content,
      status,
      ...(activeForm !== undefined ? { active_form: activeForm } : {}),
    });
  }
  return items;
}

const userMessage = defineMapping<Raw>({
  match: { type: "user" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record)) return [];
    if (record.isCompactSummary === true) {
      const text =
        stringValue(record.summary) ??
        stringValue(record.message?.content) ??
        jsonString(record.message?.content);
      if (text === undefined) return [];
      return [
        {
          type: "context_compact",
          payload: { summary: text, trigger: "auto" },
          source: src(record, "user"),
          meta: meta(record),
        },
      ];
    }
    const content = record.message?.content;
    if (typeof content === "string") {
      const interrupt = isInterruptMarker(content);
      if (interrupt !== undefined) {
        return [
          {
            type: "user_interrupt",
            payload: { reason: interrupt.reason },
            source: src(record, "user"),
            meta: meta(record),
          },
        ];
      }
      if (isContinuationPreamble(content)) {
        return [
          {
            type: "system_event",
            payload: { kind: "session_start", text: content },
            source: src(record, "user"),
            meta: meta(record),
          },
        ];
      }
      return [
        {
          type: "user_message",
          payload: { text: content },
          source: src(record, "user"),
          meta: meta(record),
        },
      ];
    }
    const blocks = asBlocks(content).filter((b) => b.type === "text" || b.type === "tool_result");
    return blocks.flatMap((block, i): TrailEntryDraft[] => {
      const envelopeRef = i > 0 ? "" : undefined;
      const source = src(record, String(block.type), block, i, { envelopeRef });
      if (block.type === "text" && typeof block.text === "string") {
        const interrupt = isInterruptMarker(block.text);
        if (interrupt !== undefined) {
          return [
            {
              type: "user_interrupt",
              payload: { reason: interrupt.reason },
              source,
              meta: meta(record),
            },
          ];
        }
        if (isContinuationPreamble(block.text)) {
          return [
            {
              type: "system_event",
              payload: { kind: "x-claudecode/system", text: block.text },
              source,
              meta: meta(record),
            },
          ];
        }
        return [
          { type: "user_message", payload: { text: block.text }, source, meta: meta(record) },
        ];
      }
      if (block.type === "tool_result") {
        const callId = stringValue(block.tool_use_id);
        const ok = block.is_error !== true;
        const output = textFromToolResultContent(block.content);
        return [
          {
            type: "tool_result",
            payload: {
              ok,
              ...(output.length > 0 ? { output } : {}),
              ...(!ok && output.length > 0 ? { error: output } : {}),
            },
            source,
            meta: meta(record, { callId }),
          },
        ];
      }
      return [];
    });
  },
});

const assistantMessage = defineMapping<Raw>({
  match: { type: "assistant" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record)) return [];
    const blocks = asBlocks(record.message?.content).filter(
      (b) =>
        b.type === "text" ||
        b.type === "thinking" ||
        b.type === "redacted_thinking" ||
        b.type === "tool_use",
    );
    const model = stringValue(record.message?.model);
    const usage = mapAgentMessageUsage(record.message?.usage);
    let usageEmitted = false;
    return blocks.flatMap((block, i): TrailEntryDraft[] => {
      const envelopeRef = i > 0 ? "" : undefined;
      const source = src(record, String(block.type), block, i, { envelopeRef });
      if (block.type === "text" && typeof block.text === "string") {
        const blockUsage = !usageEmitted ? usage : undefined;
        if (blockUsage !== undefined) usageEmitted = true;
        return [
          {
            type: "agent_message",
            payload: {
              text: block.text,
              ...(model !== undefined ? { model } : {}),
              ...(typeof record.message?.stop_reason === "string"
                ? { stop_reason: record.message.stop_reason }
                : {}),
              ...(blockUsage !== undefined ? { usage: blockUsage } : {}),
            },
            source,
            meta: meta(record, { model }),
          },
        ];
      }
      if (block.type === "thinking" || block.type === "redacted_thinking") {
        const text =
          stringValue(block.thinking) ??
          stringValue(block.data) ??
          (block.type === "redacted_thinking" ? "[redacted thinking]" : "");
        return [
          {
            type: "agent_thinking",
            payload: { text, ...(model !== undefined ? { model } : {}) },
            source,
            meta: meta(record, { model }),
          },
        ];
      }
      if (block.type === "tool_use") {
        const callId = stringValue(block.id);
        const toolName = stringValue(block.name);
        const taskPlanItems =
          toolName === "TodoWrite" ? taskPlanItemsFromTodoWrite(block.input) : undefined;
        if (taskPlanItems !== undefined) {
          const taskPlanCallId = isNonEmptyString(callId) ? callId : undefined;
          return [
            {
              type: "task_plan_update",
              payload: { items: taskPlanItems },
              ...(taskPlanCallId !== undefined ? { semantic: { call_id: taskPlanCallId } } : {}),
              source,
              meta: meta(record, { model, callId: taskPlanCallId }),
            } as TrailEntryDraft,
          ];
        }
        if (toolName === "AskUserQuestion") {
          const payload = userQueryPayload(block.input);
          if (payload !== undefined) {
            const queryCallId = isNonEmptyString(callId) ? callId : undefined;
            return [
              {
                type: "user_query",
                payload,
                ...(queryCallId !== undefined ? { semantic: { call_id: queryCallId } } : {}),
                source,
                meta: meta(record, { model, callId: queryCallId }),
              },
            ];
          }
        }
        const mapped = toolKindAndArgs(toolName, block.input);
        return [
          {
            type: "tool_call",
            payload: mapped,
            semantic: {
              ...(callId !== undefined ? { call_id: callId } : {}),
              tool_kind: mapped.tool as ToolKind,
            },
            source,
            meta: meta(record, { model, callId }),
          },
        ];
      }
      return [];
    });
  },
});

const summary = defineMapping<Raw>({
  match: { type: "summary" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record)) return [];
    const text =
      stringValue(record.summary) ??
      stringValue(record.message?.content) ??
      jsonString(record.message?.content);
    if (text === undefined) return [];
    if (record.isCompactSummary === true) {
      return [
        {
          type: "context_compact",
          payload: { summary: text, trigger: "auto" },
          source: src(record, "summary"),
          meta: meta(record),
        },
      ];
    }
    return [
      {
        type: "session_summary",
        payload: { scope: "session", text },
        // v1 always emits a `semantic` object (empty when there is no leafUuid).
        semantic: typeof record.leafUuid === "string" ? { group_id: record.leafUuid } : {},
        source: src(record, "summary"),
        meta: meta(record),
      },
    ];
  },
});

const aiTitleMetadata = defineMapping<Raw>({
  match: { type: "ai-title" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const aiTitle = stringValue(record.aiTitle);
    if (aiTitle === undefined) return [];
    return [
      {
        type: "session_metadata_update",
        payload: { field: "name", value: aiTitle, reason: "ai_generated" },
        source: metadataSource(record, "ai-title"),
        meta: meta(record),
      },
    ];
  },
});

const agentNameMetadata = defineMapping<Raw>({
  match: { type: "agent-name" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const agentName = stringValue(record.agentName);
    if (agentName === undefined) return [];
    return [
      {
        type: "session_metadata_update",
        payload: {
          field: "x-claudecode/agent_name",
          value: agentName,
          reason: "ai_generated",
        },
        source: metadataSource(record, "agent-name"),
        meta: meta(record),
      },
    ];
  },
});

const worktreeStateMetadata = defineMapping<Raw>({
  match: { type: "worktree-state" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const ws = isObject(record.worktreeSession) ? record.worktreeSession : undefined;
    if (ws === undefined) return [];

    const entries: TrailEntryDraft[] = [];
    const branch = stringValue(ws.worktreeBranch);
    if (branch !== undefined) {
      entries.push({
        type: "session_metadata_update",
        payload: { field: "vcs.branch", value: branch, reason: "runtime_inferred" },
        source: metadataSource(record, "worktree-state"),
        meta: meta(record),
      });
    }

    const name = stringValue(ws.worktreeName);
    const path = stringValue(ws.worktreePath);
    if (name !== undefined && path !== undefined) {
      const worktree: Record<string, unknown> = { name, path };
      const originalCwd = stringValue(ws.originalCwd);
      const originalBranch = stringValue(ws.originalBranch);
      const originalHeadCommit = stringValue(ws.originalHeadCommit);
      if (originalCwd !== undefined) worktree.original_cwd = originalCwd;
      if (originalBranch !== undefined) worktree.original_branch = originalBranch;
      if (originalHeadCommit !== undefined && /^[a-f0-9]{7,64}$/.test(originalHeadCommit)) {
        worktree.original_head_commit = originalHeadCommit;
      }
      entries.push({
        type: "session_metadata_update",
        payload: { field: "vcs.worktree", value: worktree, reason: "runtime_inferred" },
        source: metadataSource(record, "worktree-state"),
        meta: meta(record),
      });
    }

    return entries;
  },
});

function systemEvent(payloadType: string, allowNoUuid: boolean): MappingDef<Raw> {
  return defineMapping<Raw>({
    match: { type: payloadType },
    emit: (raw) => {
      const record = raw as CcEnvelope;
      if (!gate(record, allowNoUuid)) return [];
      const synthesized = typeof record.uuid !== "string";
      const data = systemEventData(record);
      const drafts: TrailEntryDraft[] = [
        {
          type: "system_event",
          payload: {
            kind: systemEventKind(record),
            text: systemEventText(record),
            ...(data !== undefined ? { data } : {}),
          },
          source: src(
            record,
            payloadType,
            undefined,
            undefined,
            synthesized ? { synthesized: true } : undefined,
          ),
          meta: meta(record),
        },
      ];
      if (
        record.type === "system" &&
        stringValue(record.subtype) === "stop_hook_summary" &&
        Array.isArray(record.hookErrors)
      ) {
        drafts.push(
          ...record.hookErrors.filter(isObject).map((error, index) =>
            hookFailureDraft(record, "system.stop_hook_summary.hook_error", error, {
              sourceBlock: error,
              sourceBlockIndex: index,
            }),
          ),
        );
      }
      return drafts;
    },
  });
}

const permissionMode = defineMapping<Raw>({
  match: { type: "permission-mode" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const mode = stringValue(record.permissionMode);
    if (mode === undefined) return [];
    // Base entry; ccPermissionModeDelta fills data.from + delta text from the prior mode.
    return [
      {
        type: "system_event",
        payload: {
          kind: "permission_mode_change",
          text: `Permission mode: ${mode}`,
          data: { to: mode },
        },
        source: src(record, "permission-mode", undefined, undefined, { synthesized: true }),
        meta: meta(record),
      },
    ];
  },
});

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

function hookSuccessData(attachment: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const hookEvent = stringValue(attachment.hook_event) ?? stringValue(attachment.hookEvent);
  if (hookEvent !== undefined) data.hook_event = hookEvent;
  const hookName = stringValue(attachment.hook_name) ?? stringValue(attachment.hookName);
  if (hookName !== undefined) data.hook_name = hookName;
  const toolCallId =
    stringValue(attachment.tool_call_id) ??
    stringValue(attachment.toolCallId) ??
    stringValue(attachment.tool_use_id) ??
    stringValue(attachment.toolUseID);
  if (toolCallId !== undefined) data.tool_call_id = toolCallId;
  const exitCode = numberValue(attachment.exit_code) ?? numberValue(attachment.exitCode);
  if (exitCode !== undefined) data.exit_code = Math.trunc(exitCode);
  const durationMs = numberValue(attachment.duration_ms) ?? numberValue(attachment.durationMs);
  if (durationMs !== undefined) data.duration_ms = Math.trunc(durationMs);
  const command = stringValue(attachment.command);
  if (command !== undefined) data.command = command;
  const stdout = stringValue(attachment.stdout);
  if (stdout !== undefined) data.stdout_excerpt = stdout;
  const stderr = stringValue(attachment.stderr);
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

  if (subtype === "hook_blocking_error" || subtype === "hook_non_blocking_error") {
    return [
      hookFailureDraft(record, originalType, attachment, {
        fallbackBlocking: subtype === "hook_blocking_error",
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
    const rawToolCallId =
      stringValue(attachment.tool_call_id) ??
      stringValue(attachment.toolCallId) ??
      stringValue(attachment.tool_use_id) ??
      stringValue(attachment.toolUseID);
    const toolCallId = isNonEmptyString(rawToolCallId) ? rawToolCallId : undefined;
    return [
      {
        type: "system_event",
        payload: {
          kind: hookEventToKind(hookEvent),
          text: hookSuccessText(hookEvent, hookName),
          data: hookSuccessData(attachment),
        },
        ...(toolCallId !== undefined ? { semantic: { call_id: toolCallId } } : {}),
        source: src(record, originalType),
        meta: meta(record, { callId: toolCallId }),
      },
    ];
  }

  if (subtype === "hook_permission_decision") {
    const decision = permissionDecision(attachment.decision);
    if (decision === undefined) return [];
    const data: Record<string, unknown> = { decision };
    const rawToolCallId =
      stringValue(attachment.tool_call_id) ??
      stringValue(attachment.toolCallId) ??
      stringValue(attachment.tool_use_id) ??
      stringValue(attachment.toolUseID);
    const toolCallId = isNonEmptyString(rawToolCallId) ? rawToolCallId : undefined;
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

export const claudeCodeMappings: MappingDef<Raw>[] = [
  userMessage,
  assistantMessage,
  summary,
  aiTitleMetadata,
  agentNameMetadata,
  worktreeStateMetadata,
  capabilityAttachment,
  topLevelCommandPermissions,
  topLevelHookPermissionDecision,
  systemEvent("system", false),
  systemEvent("progress", false),
  systemEvent("queue-operation", true),
  systemEvent("pr-link", true),
  permissionMode,
];
