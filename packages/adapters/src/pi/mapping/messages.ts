import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping, mapAgentMessageUsage } from "@agent-trail/adapter-kit";
import type { ToolKind } from "@agent-trail/types";
import {
  asBlocks,
  idValue,
  isObject,
  type PiBlock,
  type PiEnvelope,
  stringValue,
  textFromContent,
} from "../source.ts";
import { toolKindAndArgs } from "../tools.ts";
import type { PiMappingContext } from "./context.ts";
import { metaFor } from "./shared.ts";

export function messageMappings(ctx: PiMappingContext): MappingDef<PiEnvelope>[] {
  const { emittableTs, src } = ctx;

  const userMessage = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "user" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const msg = record.message as NonNullable<PiEnvelope["message"]>;
      const content = msg.content;
      const text = typeof content === "string" ? content : textFromContent(content);
      return [
        {
          type: "user_message",
          payload: { text },
          source: src(record, "message"),
          meta: metaFor(record, "user_message_envelope"),
        },
      ];
    },
  });

  const assistantMessage = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "assistant" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const msg = record.message as NonNullable<PiEnvelope["message"]>;
      const aborted = msg.stopReason === "aborted";
      const content = msg.content;
      const usage = mapAgentMessageUsage(msg.usage);
      const model = stringValue(msg.model);
      const stopReason = stringValue(msg.stopReason);
      let usageEmitted = false;
      const consumeUsage = () => {
        const blockUsage = !usageEmitted ? usage : undefined;
        if (blockUsage !== undefined) usageEmitted = true;
        return blockUsage;
      };

      const out: TrailEntryDraft[] = [];

      if (typeof content === "string") {
        const contentUsage = consumeUsage();
        out.push({
          type: "agent_message",
          payload: {
            text: content,
            ...(model !== undefined ? { model } : {}),
            ...(stopReason !== undefined ? { stop_reason: stopReason } : {}),
            ...(contentUsage !== undefined ? { usage: contentUsage } : {}),
          },
          source: src(record, "message"),
          meta: metaFor(record, "assistant_string_content", undefined, { model }),
        });
      } else {
        const blocks = asBlocks(content);
        const emittable: Array<{ block: PiBlock; originalIndex: number }> = [];
        for (const [originalIndex, block] of blocks.entries()) {
          if (block.type === "text" || block.type === "toolCall" || block.type === "thinking") {
            emittable.push({ block, originalIndex });
          }
        }
        emittable.forEach(({ block, originalIndex }, emittedIndex) => {
          const envelopeRef = emittedIndex > 0 ? "" : undefined;
          if (block.type === "text" && typeof block.text === "string") {
            const blockUsage = consumeUsage();
            out.push({
              type: "agent_message",
              payload: {
                text: block.text,
                ...(model !== undefined ? { model } : {}),
                ...(stopReason !== undefined ? { stop_reason: stopReason } : {}),
                ...(blockUsage !== undefined ? { usage: blockUsage } : {}),
              },
              source: src(record, "text", block, originalIndex, { envelopeRef }),
              meta: metaFor(record, "assistant_text_block", undefined, { model }),
            });
          } else if (block.type === "thinking") {
            const rawThinking = typeof block.thinking === "string" ? block.thinking : "";
            const redacted = block.redacted === true && rawThinking.length === 0;
            const blockUsage = consumeUsage();
            out.push({
              type: "agent_thinking",
              payload: {
                text: redacted ? "[redacted thinking]" : rawThinking,
                ...(model !== undefined ? { model } : {}),
                ...(blockUsage !== undefined ? { usage: blockUsage } : {}),
              },
              source: src(record, "thinking", block, originalIndex, { envelopeRef }),
              meta: metaFor(
                record,
                redacted ? "assistant_redacted_thinking_block" : "assistant_thinking_block",
                undefined,
                { model },
              ),
            });
          } else if (block.type === "toolCall") {
            const name = stringValue(block.name);
            const callId = idValue(block.id);
            const mapped = toolKindAndArgs(name, block.arguments);
            const blockUsage = consumeUsage();
            out.push({
              type: "tool_call",
              payload: { ...mapped, ...(blockUsage !== undefined ? { usage: blockUsage } : {}) },
              semantic: {
                ...(callId !== undefined ? { call_id: callId } : {}),
                tool_kind: mapped.tool as ToolKind,
              },
              source: src(record, "toolCall", block, originalIndex, { envelopeRef }),
              meta: {
                ...(callId !== undefined ? { linker: { call_id: callId } } : {}),
                ...metaFor(record, "assistant_toolcall_block", undefined, { model }),
              },
            });
          }
        });
      }

      if (aborted) {
        out.push({
          type: "user_interrupt",
          payload: { reason: "stop_reason_aborted" },
          source: src(record, "assistant", undefined, undefined, { synthesized: true }),
          meta: metaFor(record, "aborted_assistant_synthetic", undefined, { model }),
        });
      }
      return out;
    },
  });

  const toolResult = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "toolResult" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const msg = record.message as NonNullable<PiEnvelope["message"]>;
      const callId = idValue(msg.toolCallId);
      const ok = msg.isError !== true;
      const output = textFromContent(msg.content);
      const details = isObject(msg.details) ? msg.details : undefined;
      const toolMetadata = isObject(details?.toolMetadata) ? details.toolMetadata : undefined;
      const contextAtCompletion = isObject(toolMetadata?.contextAtCompletion)
        ? toolMetadata.contextAtCompletion
        : undefined;
      const toolName = stringValue(msg.toolName);
      const piMeta: Record<string, unknown> = {};
      if (contextAtCompletion !== undefined)
        piMeta["dev.pi.context_at_completion"] = contextAtCompletion;
      if (toolName !== undefined) piMeta["dev.pi.tool_name"] = toolName;
      return [
        {
          type: "tool_result",
          payload: {
            ok,
            ...(output.length > 0 ? { output } : {}),
            ...(!ok && output.length > 0 ? { error: output } : {}),
          },
          source: src(record, "message"),
          meta: {
            ...(callId !== undefined ? { linker: { call_id: callId } } : {}),
            ...metaFor(
              record,
              "tool_result_envelope",
              Object.keys(piMeta).length > 0 ? piMeta : undefined,
            ),
          },
        },
      ];
    },
  });

  const bashExecution = defineMapping<PiEnvelope>({
    match: { type: "message", message: { role: "bashExecution" } },
    emit: (record) => {
      if (emittableTs(record) === null) return [];
      const msg = record.message as NonNullable<PiEnvelope["message"]>;
      const command = stringValue(msg.command);
      if (command === undefined) return [];
      const callId = `x-pi/bash:${record.id}`;
      const cancelled = msg.cancelled === true;
      const exitCode = typeof msg.exitCode === "number" ? msg.exitCode : undefined;
      const ok = !cancelled && (exitCode === undefined || exitCode === 0);
      const output = stringValue(msg.output);
      const callMeta: Record<string, unknown> = { "dev.pi.user_shell": true };
      if (msg.excludeFromContext === true) callMeta["dev.pi.exclude_from_context"] = true;
      const shellMeta: Record<string, unknown> = {};
      if (exitCode !== undefined) shellMeta.exit_code = exitCode;
      const resultMeta: Record<string, unknown> = {};
      if (msg.truncated === true) resultMeta["dev.pi.truncated"] = true;
      if (cancelled) resultMeta["dev.pi.cancelled"] = true;
      const fullOutputPath = stringValue(msg.fullOutputPath);
      if (fullOutputPath !== undefined) resultMeta["dev.pi.full_output_path"] = fullOutputPath;
      const call: TrailEntryDraft = {
        type: "tool_call",
        payload: { tool: "shell_command", args: { command } },
        semantic: { call_id: callId, tool_kind: "shell_command" },
        source: src(record, "bashExecution"),
        meta: {
          linker: { call_id: callId },
          ...metaFor(record, "bash_execution", callMeta),
        },
      };
      if (cancelled) {
        return [
          call,
          {
            type: "tool_call_aborted",
            payload: { scope: "tool_call", reason: "user_interrupt" },
            source: src(record, "bashExecution"),
            meta: {
              linker: { call_id: callId },
              ...metaFor(
                record,
                "bash_execution",
                Object.keys(resultMeta).length > 0 ? resultMeta : undefined,
              ),
            },
          },
        ];
      }
      return [
        call,
        {
          type: "tool_result",
          payload: {
            ok,
            ...(output !== undefined && output.length > 0 ? { output } : {}),
            ...(Object.keys(shellMeta).length > 0 ? { meta: { shell_command: shellMeta } } : {}),
          },
          semantic: { call_id: callId, tool_kind: "shell_command" },
          source: src(record, "bashExecution"),
          meta: {
            linker: { call_id: callId },
            ...metaFor(
              record,
              "bash_execution",
              Object.keys(resultMeta).length > 0 ? resultMeta : undefined,
            ),
          },
        },
      ];
    },
  });

  return [userMessage, assistantMessage, toolResult, bashExecution];
}
