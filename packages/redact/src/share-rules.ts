import type { JsonlRecord } from "@agent-trail/core";
import { addMutationCount } from "./mutation-accounting.ts";
import type { RedactionSummary } from "./types.ts";

const SHA256_REF_RE = /^sha256:[0-9a-f]{64}$/;

export function applyAttachmentUriRules(
  records: JsonlRecord[],
  rewrites: Record<string, `sha256:${string}`> | undefined,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (
      value.type !== "user_message" &&
      value.type !== "agent_message" &&
      value.type !== "tool_result"
    ) {
      continue;
    }
    const payload = value.payload as Record<string, unknown> | undefined;
    const attachments = payload?.attachments;
    if (!Array.isArray(attachments)) continue;

    for (let i = 0; i < attachments.length; i += 1) {
      const attachment = attachments[i];
      if (attachment === null || typeof attachment !== "object") continue;
      const object = attachment as Record<string, unknown>;
      const uri = object.uri;
      if (typeof uri !== "string" || !uri.startsWith("file:")) continue;

      const rewrite = rewrites?.[uri];
      if (typeof rewrite === "string" && SHA256_REF_RE.test(rewrite)) {
        object.uri = rewrite;
        recordMutation(
          summary,
          maxSamples,
          "attachment_file_uri_rewritten",
          `records[${recordIndex}].payload.attachments[${i}].uri`,
          "file:",
          rewrite,
        );
      } else {
        delete object.uri;
        recordMutation(
          summary,
          maxSamples,
          "attachment_file_uri_removed",
          `records[${recordIndex}].payload.attachments[${i}].uri`,
          "file:",
          "[STRIPPED]",
        );
      }
      addMutationCount(mutationCounts, recordIndex, 1);
    }
  }
}

export function stripUnsafeOverflowRefs(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "tool_result") continue;
    const payload = value.payload as Record<string, unknown> | undefined;
    const overflowRef = payload?.overflow_ref;
    if (typeof overflowRef !== "string" || overflowRef.startsWith("sha256:")) continue;
    if (payload === undefined) continue;
    delete payload.overflow_ref;
    recordMutation(
      summary,
      maxSamples,
      "overflow_ref_stripped",
      `records[${recordIndex}].payload.overflow_ref`,
      overflowRef,
      "[STRIPPED]",
    );
    addMutationCount(mutationCounts, recordIndex, 1);
  }
}

export function stripUnresolvedUserQueryResponses(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  const groupByRecordIndex = new Map<number, number>();
  const queriesByGroup = new Map<number, Set<string>>();
  let group = -1;
  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type === "session") group += 1;
    groupByRecordIndex.set(recordIndex, group);
    if (value.type !== "user_query" || typeof value.id !== "string") continue;
    const ids = queriesByGroup.get(group) ?? new Set<string>();
    ids.add(value.id);
    queriesByGroup.set(group, ids);
  }

  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query_response") continue;
    const payload = value.payload as { for_id?: unknown; answers?: unknown } | undefined;
    if (typeof payload?.for_id !== "string") continue;
    if (
      payload.answers === null ||
      typeof payload.answers !== "object" ||
      Array.isArray(payload.answers)
    ) {
      continue;
    }
    const recordGroup = groupByRecordIndex.get(recordIndex) ?? -1;
    if (queriesByGroup.get(recordGroup)?.has(payload.for_id) === true) continue;
    if (Object.keys(payload.answers as Record<string, unknown>).length === 0) continue;

    payload.answers = {};
    recordMutation(
      summary,
      maxSamples,
      "user_query_response_unresolved_answers_stripped",
      `records[${recordIndex}].payload.answers`,
      "[unresolved user_query_response answers]",
      "{}",
    );
    addMutationCount(mutationCounts, recordIndex, 1);
  }
}

function recordMutation(
  summary: RedactionSummary,
  maxSamples: number,
  patternId: string,
  location: string,
  before: string,
  after: string,
): void {
  summary.counts[patternId] = (summary.counts[patternId] ?? 0) + 1;
  if (summary.samples.length >= maxSamples) return;
  summary.samples.push({ patternId, location, before, after });
}
