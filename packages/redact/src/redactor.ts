import type { JsonlRecord } from "@agent-trail/core";
import {
  addMutationCount,
  applyRedactionCounts,
  snapshotToolResultOutputSizes,
} from "./mutation-accounting.ts";
import { DEFAULT_PATTERNS } from "./patterns.ts";
import { applyPii } from "./pii.ts";
import { applyPattern, maskSample, redactString, userSecretsPatterns } from "./rules.ts";
import { truncateOutputs } from "./truncate.ts";
import type {
  RedactionPattern,
  RedactionSummary,
  RedactTrailOptions,
  RedactTrailResult,
} from "./types.ts";
import { visitStrings } from "./visits.ts";

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

function stripSecretUserQueryAnswers(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
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
    }
  }
}

// Removes vcs.remote_url from the header. Default-on per spec §15 / PRD §8.6
// step 7 because the field reveals repository identity (potentially private).
// Records the strip in the summary so share-time previews surface it.
function stripVcsRemoteUrl(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "session" && value.type !== "trail") continue;
    const vcs = value.vcs as Record<string, unknown> | undefined;
    if (vcs === undefined || typeof vcs.remote_url !== "string") continue;
    const before = vcs.remote_url;
    delete vcs.remote_url;
    summary.counts.vcs_remote_url = (summary.counts.vcs_remote_url ?? 0) + 1;
    if (summary.samples.length < maxSamples) {
      summary.samples.push({
        patternId: "vcs_remote_url",
        location: `records[${index}].vcs.remote_url`,
        before: maskSample(before),
        after: "[STRIPPED]",
      });
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

function redactUserQueryQuestionIds(
  records: JsonlRecord[],
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
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
        summary,
        maxSamples,
      );
      const after = redacted !== before ? uniqueKey(redacted, used) : redacted;
      questionObject.id = after;
      used.add(after);
      if (after !== before) idMap.set(before, after);
    }
    if (idMap.size > 0) idMaps.set(value.id, idMap);
  }

  return idMaps;
}

function redactUserQueryAnswerKeys(
  records: JsonlRecord[],
  queryIdMaps: Map<string, Map<string, string>>,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
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
        summary,
        maxSamples,
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

export function redactTrail(
  records: JsonlRecord[],
  options: RedactTrailOptions = {},
): RedactTrailResult {
  const basePatterns = options.patterns ?? DEFAULT_PATTERNS;
  const patterns = options.extendPatterns
    ? [...basePatterns, ...options.extendPatterns]
    : basePatterns;
  const userPatterns = userSecretsPatterns(options.userSecrets ?? []);
  const includeSourceRaw = options.includeSourceRaw ?? true;
  const outputMaxBytes = options.outputMaxBytes ?? 10_240;
  const maxSamples = options.maxSamples ?? 20;
  const keepRemoteUrl = options.keepRemoteUrl ?? false;
  const out = records.map((record) => structuredClone(record));
  const originalToolResultOutputSizes = snapshotToolResultOutputSizes(out);
  const rawSummary: RedactionSummary = { counts: {}, samples: [] };
  const redactionCounts = new Map<number, number>();

  if (!keepRemoteUrl) {
    stripVcsRemoteUrl(out, rawSummary, maxSamples);
  }

  const queryIdMaps = redactUserQueryQuestionIds(
    out,
    userPatterns,
    patterns,
    rawSummary,
    maxSamples,
  );
  redactUserQueryAnswerKeys(out, queryIdMaps, userPatterns, patterns, rawSummary, maxSamples);

  stripSecretUserQueryAnswers(out, rawSummary, maxSamples);

  for (const visit of visitStrings(out, includeSourceRaw)) {
    for (const pattern of userPatterns) {
      addMutationCount(
        redactionCounts,
        visit.recordIndex,
        applyPattern(visit, pattern, rawSummary, maxSamples),
      );
    }
    for (const pattern of patterns) {
      addMutationCount(
        redactionCounts,
        visit.recordIndex,
        applyPattern(visit, pattern, rawSummary, maxSamples),
      );
    }
    const current = visit.get();
    const pii = applyPii(current, visit.location, rawSummary, maxSamples);
    if (pii.text !== current) {
      visit.set(pii.text);
      addMutationCount(redactionCounts, visit.recordIndex, pii.count);
    }
    for (const sample of pii.samples) {
      if (rawSummary.samples.length >= maxSamples) break;
      rawSummary.samples.push(sample);
    }
  }

  truncateOutputs(
    out,
    outputMaxBytes,
    rawSummary,
    maxSamples,
    redactionCounts,
    originalToolResultOutputSizes,
  );
  applyRedactionCounts(out, redactionCounts);

  // Redacted bytes differ from the input artifact, so any finalized
  // content_hash carried on the input is now stale. Reset to the
  // <pending> sentinel (spec §7.3) on every session header and on the trail
  // envelope (spec §7.4, §8.6 multi-session) so strict verifiers do not flag
  // the mismatch and so share tooling recomputes the hashes on the redacted
  // artifact before publishing. Skip the reset on a true no-op pass so a
  // finalized clean trail remains verifiable after this call.
  const changed = Object.keys(rawSummary.counts).length > 0;
  if (changed) {
    for (const record of out) {
      const value = record.value as Record<string, unknown>;
      if (
        (value.type === "session" || value.type === "trail") &&
        typeof value.content_hash === "string"
      ) {
        value.content_hash = "<pending>";
      }
    }
  }

  // Resynchronize JsonlRecord.raw with mutated value so downstream consumers
  // that log or persist `.raw` cannot leak unredacted source text.
  for (const record of out) {
    record.raw = JSON.stringify(record.value);
  }

  return { records: out, summary: rawSummary };
}
