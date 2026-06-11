import type { JsonlRecord } from "@agent-trail/core";
import { addMutationCount } from "./mutation-accounting.ts";
import { redactString } from "./rules.ts";
import type { PiiConfig, RedactionPattern, RedactionSummary } from "./types.ts";

function secretQuestionIdsByQueryId(records: JsonlRecord[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const record of records) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query") continue;
    const entryId = value.id;
    const payload = value.payload as { questions?: unknown } | undefined;
    if (typeof entryId !== "string" || !Array.isArray(payload?.questions)) continue;
    const secretIds = new Set<string>();
    for (const question of payload.questions) {
      if (question === null || typeof question !== "object") continue;
      const q = question as { id?: unknown; is_secret?: unknown };
      if (typeof q.id === "string" && q.is_secret === true) secretIds.add(q.id);
    }
    if (secretIds.size > 0) out.set(entryId, secretIds);
  }
  return out;
}

export function stripSecretUserQueryAnswers(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts: Map<number, number>,
): void {
  const secretByQueryId = secretQuestionIdsByQueryId(records);
  if (secretByQueryId.size === 0) return;
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query_response") continue;
    const payload = value.payload as { for_id?: unknown; answers?: unknown } | undefined;
    if (typeof payload?.for_id !== "string") continue;
    if (payload.answers === null || typeof payload.answers !== "object") continue;
    const secretIds = secretByQueryId.get(payload.for_id);
    if (secretIds === undefined) continue;
    const source = value.source as Record<string, unknown> | undefined;
    if (source !== undefined && source.raw !== undefined) {
      const alreadyStripped =
        source.raw !== null &&
        typeof source.raw === "object" &&
        Object.keys(source.raw).length === 1 &&
        (source.raw as Record<string, unknown>).redacted ===
          "[STRIPPED secret user_query_response source.raw]";
      if (!alreadyStripped) {
        source.raw = { redacted: "[STRIPPED secret user_query_response source.raw]" };
        summary.counts.user_query_secret_source_raw =
          (summary.counts.user_query_secret_source_raw ?? 0) + 1;
        if (summary.samples.length < maxSamples) {
          summary.samples.push({
            patternId: "user_query_secret_source_raw",
            location: `records[${index}].source.raw`,
            before: "[secret source raw]",
            after: "[STRIPPED]",
          });
        }
        addMutationCount(mutationCounts, index, 1);
      }
    }
    const answers = payload.answers as Record<string, unknown>;
    for (const questionId of secretIds) {
      const answer = answers[questionId];
      if (answer === null || typeof answer !== "object") continue;
      const answerObject = answer as Record<string, unknown>;
      const hadSelected = Array.isArray(answerObject.selected) && answerObject.selected.length > 0;
      const hadOther = typeof answerObject.other === "string" && answerObject.other.length > 0;
      if (!hadSelected && !hadOther) continue;
      answerObject.selected = [];
      delete answerObject.other;
      summary.counts.user_query_secret_answer = (summary.counts.user_query_secret_answer ?? 0) + 1;
      if (summary.samples.length < maxSamples) {
        summary.samples.push({
          patternId: "user_query_secret_answer",
          location: `records[${index}].payload.answers.${questionId}`,
          before: "[secret answer]",
          after: "[STRIPPED]",
        });
      }
      addMutationCount(mutationCounts, index, 1);
    }
  }
}

function uniqueKey(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred;
  let suffix = 2;
  let candidate = `${preferred}_${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${preferred}_${suffix}`;
  }
  return candidate;
}

export function redactUserQueryQuestionIds(
  records: JsonlRecord[],
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): Map<string, Map<string, string>> {
  const idMaps = new Map<string, Map<string, string>>();

  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query" || typeof value.id !== "string") continue;
    const payload = value.payload as { questions?: unknown } | undefined;
    if (!Array.isArray(payload?.questions)) continue;

    const used = new Set<string>();
    const idMap = new Map<string, string>();
    for (let i = 0; i < payload.questions.length; i += 1) {
      const question = payload.questions[i];
      if (question === null || typeof question !== "object") continue;
      const questionObject = question as Record<string, unknown>;
      const before = questionObject.id;
      if (typeof before !== "string") continue;
      const redacted = redactString(
        before,
        `records[${index}].payload.questions[${i}].id`,
        userPatterns,
        patterns,
        allowedSecrets,
        summary,
        maxSamples,
        enableEntropyRedaction,
        pii,
      );
      const after = uniqueKey(redacted, used);
      questionObject.id = after;
      used.add(after);
      if (after !== before) idMap.set(before, after);
    }
    if (idMap.size > 0) idMaps.set(value.id, idMap);
  }

  return idMaps;
}

export function redactUserQueryAnswerKeys(
  records: JsonlRecord[],
  queryIdMaps: Map<string, Map<string, string>>,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query_response") continue;
    const payload = value.payload as { for_id?: unknown; answers?: unknown } | undefined;
    if (typeof payload?.for_id !== "string") continue;
    if (payload.answers === null || typeof payload.answers !== "object") continue;

    const answers = payload.answers as Record<string, unknown>;
    const idMap = queryIdMaps.get(payload.for_id);
    const rewritten = Object.create(null) as Record<string, unknown>;
    const used = new Set<string>();
    let changed = false;
    for (const [before, answer] of Object.entries(answers)) {
      const redacted = redactString(
        before,
        `records[${index}].payload.answers.${before}`,
        userPatterns,
        patterns,
        allowedSecrets,
        summary,
        maxSamples,
        enableEntropyRedaction,
        pii,
      );
      const mapped = idMap?.get(before) ?? redacted;
      const after = uniqueKey(mapped, used);
      used.add(after);
      rewritten[after] = answer;
      if (after !== before) changed = true;
    }
    if (changed) payload.answers = rewritten;
  }
}
