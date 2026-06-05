import type { MappingDef, TrailEntryDraft } from "@agent-trail/adapter-kit";
import type { Attachment, Entry } from "@agent-trail/types";
import {
  decodeCappedBase64,
  INLINE_MEDIA_MAX_DECODED_BYTES,
  sha256Ref,
} from "../../inline-media.ts";
import { sourceFor } from "../entry-metadata.ts";
import { asBlocks, type CcBlock, type CcEnvelope, isObject, stringValue } from "../source.ts";

export type Raw = Record<string, unknown>;
export type CcMapping = MappingDef<Raw>;

/**
 * Transient hint stashed on `meta`: source uuid (`sid`, for multi-block
 * envelope_ref backfill + model grouping) and the source assistant `model` (for
 * the synthesized model_change rule). Stripped by ccEnvelopeRefBackfill before
 * output — v1 Claude Code entries carry no entry-level meta.
 */
export const HINT = "x-claudecode/_h";
export const INCLUDE_SIDECHAIN = Symbol.for("agent-trail.claude-code.include-sidechain");
export const INLINE_ATTACHMENT_MAX_DECODED_BYTES = INLINE_MEDIA_MAX_DECODED_BYTES;
const HOOK_ADDITIONAL_CONTEXT_TEXT_MAX_CHARS = 16 * 1024;

export interface CcHint {
  sid?: string;
  model?: string;
  gitBranch?: string;
}

export function meta(
  record: CcEnvelope,
  opts?: { model?: string; callId?: string; extra?: Record<string, unknown> },
): Record<string, unknown> {
  const hint: CcHint = {
    ...(typeof record.uuid === "string" ? { sid: record.uuid } : {}),
    ...(opts?.model !== undefined ? { model: opts.model } : {}),
    ...(typeof record.gitBranch === "string" && record.gitBranch.length > 0
      ? { gitBranch: record.gitBranch }
      : {}),
  };
  return {
    // Real meta keys survive hint stripping (see ccEnvelopeRefBackfill); the
    // HINT is transient.
    ...(opts?.extra ?? {}),
    ...(opts?.callId !== undefined ? { linker: { call_id: opts.callId } } : {}),
    [HINT]: hint,
  };
}

// Subagent attribution carried on a parent-side user record: which subagent
// produced this tool_result. Sidechain inner records are dropped, so this is
// the only trace a subagent ran. Namespaced under entry.meta. See issue #126.
export function attributionMeta(record: CcEnvelope): Record<string, unknown> | undefined {
  const tur = isObject(record.toolUseResult) ? record.toolUseResult : undefined;
  const out: Record<string, unknown> = {};
  const agentId = stringValue(record.agentId) ?? stringValue(tur?.agentId);
  if (agentId !== undefined) out["dev.claudecode.agent_id"] = agentId;
  const agentType = stringValue(tur?.agentType);
  if (agentType !== undefined) out["dev.claudecode.agent_type"] = agentType;
  const sourceUuid = stringValue(record.sourceToolAssistantUUID);
  if (sourceUuid !== undefined) out["dev.claudecode.source_tool_assistant_uuid"] = sourceUuid;
  return Object.keys(out).length > 0 ? out : undefined;
}

// Pasted images/documents arrive as inline content blocks
// `{ type:"image"|"document", source:{ type:"base64", media_type, data } }`.
// Hash the decoded bytes to a content-addressed sha256 ref (v0.1 has no inline
// data: URIs); the blob store resolves it at share time. Mirrors the Codex
// adapter's image rollup (#160). See issue #126.
export function imageAttachments(content: unknown): Attachment[] {
  const out: Attachment[] = [];
  for (const block of asBlocks(content)) {
    if (block.type !== "image" && block.type !== "document") continue;
    const source = isObject(block.source) ? block.source : undefined;
    const data = stringValue(source?.data);
    if (stringValue(source?.type) !== "base64" || data === undefined) continue;
    const mediaType = stringValue(source?.media_type) ?? stringValue(source?.mediaType);
    const att: Attachment = {
      kind: block.type === "image" ? "image" : "file",
    };
    if (mediaType !== undefined) att.media_type = mediaType;
    const decoded = decodeCappedBase64(data);
    if (decoded.bytes !== undefined) att.uri = sha256Ref(decoded.bytes);
    out.push(att);
  }
  return out;
}

type HookAdditionalContextContent = {
  text?: string;
  content?: unknown;
  attachments?: Attachment[];
};

export function hookAdditionalContextContent(content: unknown): HookAdditionalContextContent {
  if (typeof content === "string") {
    return { text: truncateHookContextText(content), content: truncateHookContextText(content) };
  }
  const blocks = asBlocks(content);
  if (blocks.length === 0) return {};
  let remaining = HOOK_ADDITIONAL_CONTEXT_TEXT_MAX_CHARS;
  const textBlocks: Array<{ type: "text"; text: string }> = [];
  for (const block of blocks) {
    if (block.type !== "text" || typeof block.text !== "string" || remaining <= 0) continue;
    const separatorLength = textBlocks.length > 0 ? 1 : 0;
    const budget = remaining - separatorLength;
    if (budget <= 0) break;
    const text = block.text.slice(0, budget);
    remaining -= separatorLength + text.length;
    textBlocks.push({ type: "text", text });
  }
  const text = textBlocks.map((block) => block.text).join("\n");
  const attachments = imageAttachments(content);
  return {
    ...(text.length > 0 ? { text, content: textBlocks } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function truncateHookContextText(text: string): string {
  return text.length > HOOK_ADDITIONAL_CONTEXT_TEXT_MAX_CHARS
    ? text.slice(0, HOOK_ADDITIONAL_CONTEXT_TEXT_MAX_CHARS)
    : text;
}

export function src(
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
export function gate(record: CcEnvelope, allowNoUuid = false): boolean {
  const includeSidechain =
    (record as { [INCLUDE_SIDECHAIN]?: boolean })[INCLUDE_SIDECHAIN] === true;
  if ((record.isSidechain === true && !includeSidechain) || record.isMeta === true) return false;
  if (typeof record.timestamp !== "string") return false;
  if (!allowNoUuid && typeof record.uuid !== "string") return false;
  return true;
}

export function metadataSource(record: CcEnvelope, originalType: string): Entry["source"] {
  return src(
    record,
    originalType,
    undefined,
    undefined,
    typeof record.uuid !== "string" ? { synthesized: true } : undefined,
  );
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

export function hookFailureDraft(
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
