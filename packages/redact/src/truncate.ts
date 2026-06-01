import type { JsonlRecord } from "@agent-trail/core";
import type { RedactionSummary } from "./types.ts";

const TRUNCATION_NOTICE = "\n…[truncated]";
const TEXT_ENCODER = new TextEncoder();

function byteLength(s: string): number {
  return TEXT_ENCODER.encode(s).byteLength;
}

function truncateToByteLimit(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  if (maxBytes <= 0) return "";
  const noticeBytes = byteLength(TRUNCATION_NOTICE);
  if (maxBytes < noticeBytes) {
    return truncateRawToByteLimit(TRUNCATION_NOTICE, maxBytes);
  }
  const budget = maxBytes - noticeBytes;
  return `${truncateRawToByteLimit(text, budget)}${TRUNCATION_NOTICE}`;
}

function truncateRawToByteLimit(text: string, budget: number): string {
  if (budget <= 0) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (byteLength(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

function addMutationCount(
  counts: Map<number, number> | undefined,
  recordIndex: number,
  count: number,
): void {
  if (counts === undefined || count <= 0) return;
  counts.set(recordIndex, (counts.get(recordIndex) ?? 0) + count);
}

function hasValidOutputSize(payload: Record<string, unknown>): boolean {
  const outputSize = payload.output_size;
  return typeof outputSize === "number" && Number.isInteger(outputSize) && outputSize >= 0;
}

function truncateToolResultOutput(
  payload: Record<string, unknown>,
  recordIndex: number,
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
  originalOutputSizes?: ReadonlyMap<number, number>,
): void {
  const output = payload.output;
  if (typeof output !== "string") return;
  if (payload.truncated === true && !hasValidOutputSize(payload)) {
    payload.output_size = originalOutputSizes?.get(recordIndex) ?? byteLength(output);
    addMutationCount(mutationCounts, recordIndex, 1);
    summary.counts.output_size_repaired = (summary.counts.output_size_repaired ?? 0) + 1;
  }
  if (byteLength(output) <= maxBytes) return;
  const original = output;
  if (!hasValidOutputSize(payload)) {
    payload.output_size = originalOutputSizes?.get(recordIndex) ?? byteLength(original);
  }
  payload.output = truncateToByteLimit(output, maxBytes);
  payload.truncated = true;
  addMutationCount(mutationCounts, recordIndex, 1);
  summary.counts.output_truncated = (summary.counts.output_truncated ?? 0) + 1;
  if (summary.samples.length < maxSamples) {
    summary.samples.push({
      patternId: "output_truncated",
      location: `records[${recordIndex}].payload.output`,
      before: `${original.length} chars`,
      after: `${(payload.output as string).length} chars`,
    });
  }
}

function truncateUserQueryResponseAnswers(
  payload: Record<string, unknown>,
  recordIndex: number,
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
): void {
  const answers = payload.answers;
  if (answers === null || typeof answers !== "object") return;
  for (const [questionId, answer] of Object.entries(answers as Record<string, unknown>)) {
    if (answer === null || typeof answer !== "object") continue;
    const answerObject = answer as Record<string, unknown>;
    const selected = answerObject.selected;
    if (Array.isArray(selected)) {
      for (let i = 0; i < selected.length; i += 1) {
        const value = selected[i];
        if (typeof value !== "string" || byteLength(value) <= maxBytes) continue;
        selected[i] = truncateToByteLimit(value, maxBytes);
        addMutationCount(mutationCounts, recordIndex, 1);
        summary.counts.user_query_answer_truncated =
          (summary.counts.user_query_answer_truncated ?? 0) + 1;
        if (summary.samples.length < maxSamples) {
          summary.samples.push({
            patternId: "user_query_answer_truncated",
            location: `records[${recordIndex}].payload.answers.${questionId}.selected[${i}]`,
            before: `${value.length} chars`,
            after: `${(selected[i] as string).length} chars`,
          });
        }
      }
    }
    const other = answerObject.other;
    if (typeof other !== "string" || byteLength(other) <= maxBytes) continue;
    answerObject.other = truncateToByteLimit(other, maxBytes);
    addMutationCount(mutationCounts, recordIndex, 1);
    summary.counts.user_query_answer_truncated =
      (summary.counts.user_query_answer_truncated ?? 0) + 1;
    if (summary.samples.length < maxSamples) {
      summary.samples.push({
        patternId: "user_query_answer_truncated",
        location: `records[${recordIndex}].payload.answers.${questionId}.other`,
        before: `${other.length} chars`,
        after: `${(answerObject.other as string).length} chars`,
      });
    }
  }
}

export function truncateOutputs(
  records: JsonlRecord[],
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
  originalOutputSizes?: ReadonlyMap<number, number>,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    const payload = value.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    if (value.type === "tool_result") {
      truncateToolResultOutput(
        payload,
        index,
        maxBytes,
        summary,
        maxSamples,
        mutationCounts,
        originalOutputSizes,
      );
      continue;
    }

    if (value.type === "user_query_response") {
      truncateUserQueryResponseAnswers(
        payload,
        index,
        maxBytes,
        summary,
        maxSamples,
        mutationCounts,
      );
    }
  }
}
