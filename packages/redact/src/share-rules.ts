import type { JsonlRecord } from "@agent-trail/core";
import { addMutationCount } from "./mutation-accounting.ts";
import type { RedactionSummary } from "./types.ts";

const SHA256_REF_RE = /^sha256:[0-9a-f]{64}$/;
const UNRESOLVED_USER_QUERY_RESPONSE_RAW_SENTINEL =
  "[STRIPPED unresolved user_query_response source.raw]";

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

    for (const [i, attachment] of attachments.entries()) {
      if (attachment === null || typeof attachment !== "object") continue;
      const object = attachment as Record<string, unknown>;
      const uri = object.uri;
      if (typeof uri !== "string" || !uri.toLowerCase().startsWith("file:")) continue;

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
    if (typeof overflowRef !== "string" || SHA256_REF_RE.test(overflowRef)) continue;
    if (payload === undefined) continue;
    delete payload.overflow_ref;
    recordMutation(
      summary,
      maxSamples,
      "overflow_ref_stripped",
      `records[${recordIndex}].payload.overflow_ref`,
      "[overflow_ref]",
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
  const queriesByGroup = new Map<number, Map<string, Set<string>>>();
  let group = -1;
  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type === "session") group += 1;
    groupByRecordIndex.set(recordIndex, group);
    if (value.type !== "user_query" || typeof value.id !== "string") continue;
    const payload = value.payload as { questions?: unknown } | undefined;
    const questionIds = new Set<string>();
    if (Array.isArray(payload?.questions)) {
      for (const question of payload.questions) {
        if (question === null || typeof question !== "object") continue;
        const id = (question as { id?: unknown }).id;
        if (typeof id === "string") questionIds.add(id);
      }
    }
    const queries = queriesByGroup.get(group) ?? new Map<string, Set<string>>();
    queries.set(value.id, questionIds);
    queriesByGroup.set(group, queries);
  }

  for (const [recordIndex, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query_response") continue;
    const payload = value.payload as { for_id?: unknown; answers?: unknown } | undefined;
    if (typeof payload?.for_id !== "string") continue;
    const answers =
      payload.answers !== null &&
      typeof payload.answers === "object" &&
      !Array.isArray(payload.answers)
        ? (payload.answers as Record<string, unknown>)
        : undefined;
    const recordGroup = groupByRecordIndex.get(recordIndex) ?? -1;
    const questionIds = queriesByGroup.get(recordGroup)?.get(payload.for_id);
    const source = value.source as Record<string, unknown> | undefined;

    if (questionIds !== undefined) {
      if (answers === undefined) continue;
      const unknownAnswerKeys = Object.keys(answers).filter((key) => !questionIds.has(key));
      if (unknownAnswerKeys.length === 0) continue;
      for (const key of unknownAnswerKeys) delete answers[key];
      recordMutation(
        summary,
        maxSamples,
        "user_query_response_unknown_answers_stripped",
        `records[${recordIndex}].payload.answers`,
        "[unknown user_query_response answers]",
        "[STRIPPED]",
      );
      addMutationCount(mutationCounts, recordIndex, 1);
      stripUserQueryResponseSourceRaw(
        source,
        recordIndex,
        summary,
        maxSamples,
        mutationCounts,
        "user_query_response_unknown_source_raw_stripped",
        "[unknown user_query_response source.raw]",
      );
      continue;
    }

    if (answers !== undefined && Object.keys(answers).length > 0) {
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

    stripUserQueryResponseSourceRaw(
      source,
      recordIndex,
      summary,
      maxSamples,
      mutationCounts,
      "user_query_response_unresolved_source_raw_stripped",
      "[unresolved user_query_response source.raw]",
    );
  }
}

function stripUserQueryResponseSourceRaw(
  source: Record<string, unknown> | undefined,
  recordIndex: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
  patternId: string,
  before: string,
): void {
  if (source?.raw === undefined) return;
  const alreadyStripped =
    source.raw !== null &&
    typeof source.raw === "object" &&
    Object.keys(source.raw).length === 1 &&
    (source.raw as Record<string, unknown>).redacted ===
      UNRESOLVED_USER_QUERY_RESPONSE_RAW_SENTINEL;
  if (alreadyStripped) return;
  source.raw = { redacted: UNRESOLVED_USER_QUERY_RESPONSE_RAW_SENTINEL };
  recordMutation(
    summary,
    maxSamples,
    patternId,
    `records[${recordIndex}].source.raw`,
    before,
    "[STRIPPED]",
  );
  addMutationCount(mutationCounts, recordIndex, 1);
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
