import { createHash } from "node:crypto";
import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping, mapAgentMessageUsage } from "@agent-trail/adapter-kit";
import type { ToolKind } from "@agent-trail/types";
import {
  isNonEmptyString,
  isTaskPlanStatus,
  normalizeTaskPlanContent,
  type TaskPlanItem,
  taskPlanItemId,
} from "../task-plan.ts";
import { systemEventData, systemEventKind, systemEventText } from "./envelope-mappers.ts";
import { capabilityMappings } from "./mapping/capabilities.ts";
import {
  attributionMeta,
  gate,
  hookFailureDraft,
  imageAttachments,
  meta,
  metadataSource,
  type Raw,
  src,
} from "./mapping/shared.ts";
import {
  asBlocks,
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

type UserQueryOption = { label: string; description?: string };

export {
  type CcHint,
  HINT,
  INCLUDE_SIDECHAIN,
  INLINE_ATTACHMENT_MAX_DECODED_BYTES,
} from "./mapping/shared.ts";

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
    const attribution = attributionMeta(record);
    const drafts = ((): TrailEntryDraft[] => {
      if (record.isCompactSummary === true) {
        const text =
          stringValue(record.summary) ??
          stringValue(record.message?.content) ??
          jsonString(record.message?.content);
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
      const images = imageAttachments(content);
      const blocks = asBlocks(content).filter((b) => b.type === "text" || b.type === "tool_result");
      const blockDrafts = blocks.flatMap((block, i): TrailEntryDraft[] => {
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
      if (images.length === 0) return blockDrafts;
      // Fold pasted images onto the owning user turn. Attach to the first
      // user_message; if the turn carried no text block, synthesize one.
      const idx = blockDrafts.findIndex((d) => d.type === "user_message");
      if (idx >= 0) {
        const owner = blockDrafts[idx];
        if (owner !== undefined) {
          blockDrafts[idx] = {
            ...owner,
            payload: { ...(owner.payload ?? {}), attachments: images },
          };
        }
        return blockDrafts;
      }
      return [
        {
          type: "user_message",
          payload: { text: "", attachments: images },
          source: src(record, "user"),
          meta: meta(record),
        },
        ...blockDrafts,
      ];
    })();
    if (attribution === undefined) return drafts;
    return drafts.map((d) => ({ ...d, meta: { ...attribution, ...(d.meta ?? {}) } }));
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
    // requestId groups all entries split out of one LLM request envelope. See
    // issue #126; matches the spec's semantic.group_id ("one LLM request's
    // events"). The reconciler preserves it when adding tool_kind to tool_calls.
    const groupId = stringValue(record.requestId);
    const sem = (extra?: Record<string, unknown>): Record<string, unknown> | undefined => {
      const s = { ...(groupId !== undefined ? { group_id: groupId } : {}), ...(extra ?? {}) };
      return Object.keys(s).length > 0 ? s : undefined;
    };
    return blocks.flatMap((block, i): TrailEntryDraft[] => {
      const envelopeRef = i > 0 ? "" : undefined;
      const source = src(record, String(block.type), block, i, { envelopeRef });
      if (block.type === "text" && typeof block.text === "string") {
        const blockUsage = !usageEmitted ? usage : undefined;
        if (blockUsage !== undefined) usageEmitted = true;
        const semantic = sem();
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
            ...(semantic !== undefined ? { semantic } : {}),
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
        const semantic = sem();
        return [
          {
            type: "agent_thinking",
            payload: { text, ...(model !== undefined ? { model } : {}) },
            ...(semantic !== undefined ? { semantic } : {}),
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
          const semantic = sem(
            taskPlanCallId !== undefined ? { call_id: taskPlanCallId } : undefined,
          );
          return [
            {
              type: "task_plan_update",
              payload: { items: taskPlanItems },
              ...(semantic !== undefined ? { semantic } : {}),
              source,
              meta: meta(record, { model, callId: taskPlanCallId }),
            } as TrailEntryDraft,
          ];
        }
        if (toolName === "AskUserQuestion") {
          const payload = userQueryPayload(block.input);
          if (payload !== undefined) {
            const queryCallId = isNonEmptyString(callId) ? callId : undefined;
            const semantic = sem(queryCallId !== undefined ? { call_id: queryCallId } : undefined);
            return [
              {
                type: "user_query",
                payload,
                ...(semantic !== undefined ? { semantic } : {}),
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
            semantic: sem({
              ...(callId !== undefined ? { call_id: callId } : {}),
              tool_kind: mapped.tool as ToolKind,
            }),
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
    // Base entry; ccPermissionModeDelta fills from_mode from the prior mode.
    return [
      {
        type: "mode_change",
        payload: {
          scope: "permission",
          to_mode: mode,
        },
        source: src(record, "permission-mode", undefined, undefined, { synthesized: true }),
        meta: meta(record),
      },
    ];
  },
});

export const claudeCodeMappings: MappingDef<Raw>[] = [
  userMessage,
  assistantMessage,
  summary,
  aiTitleMetadata,
  agentNameMetadata,
  worktreeStateMetadata,
  ...capabilityMappings,
  systemEvent("system", false),
  systemEvent("progress", false),
  systemEvent("queue-operation", true),
  systemEvent("pr-link", true),
  permissionMode,
];
