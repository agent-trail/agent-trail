import { createHash } from "node:crypto";
import type { TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping, mapAgentMessageUsage } from "@agent-trail/adapter-kit";
import type { ToolKind } from "@agent-trail/types";
import {
  isNonEmptyString,
  isTaskPlanStatus,
  normalizeTaskPlanContent,
  type TaskPlanItem,
  taskPlanItemId,
} from "../../task-plan.ts";
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
} from "../source.ts";
import { toolKindAndArgs } from "../tools.ts";
import { attributionMeta, gate, imageAttachments, meta, type Raw, src } from "./shared.ts";

type UserQueryOption = { label: string; description?: string };

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
    const consumeUsage = () => {
      const blockUsage = !usageEmitted ? usage : undefined;
      if (blockUsage !== undefined) usageEmitted = true;
      return blockUsage;
    };
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
        const blockUsage = consumeUsage();
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
        const blockUsage = consumeUsage();
        const semantic = sem();
        return [
          {
            type: "agent_thinking",
            payload: {
              text,
              ...(model !== undefined ? { model } : {}),
              ...(blockUsage !== undefined ? { usage: blockUsage } : {}),
            },
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
        const blockUsage = consumeUsage();
        return [
          {
            type: "tool_call",
            payload: { ...mapped, ...(blockUsage !== undefined ? { usage: blockUsage } : {}) },
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

export const messageMappings = [userMessage, assistantMessage, summary];
