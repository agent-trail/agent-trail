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

export function truncateOutputs(
  records: JsonlRecord[],
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    const payload = value.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    if (value.type === "tool_result") {
      const output = payload.output;
      if (typeof output !== "string") continue;
      if (byteLength(output) <= maxBytes) continue;
      const original = output;
      payload.output = truncateToByteLimit(output, maxBytes);
      payload.truncated = true;
      summary.counts.output_truncated = (summary.counts.output_truncated ?? 0) + 1;
      if (summary.samples.length < maxSamples) {
        summary.samples.push({
          patternId: "output_truncated",
          location: `records[${index}].payload.output`,
          before: `${original.length} chars`,
          after: `${(payload.output as string).length} chars`,
        });
      }
      continue;
    }

    if (value.type !== "user_query_response") continue;
    const answers = payload.answers;
    if (answers === null || typeof answers !== "object") continue;
    for (const [questionId, answer] of Object.entries(answers as Record<string, unknown>)) {
      if (answer === null || typeof answer !== "object") continue;
      const answerObject = answer as Record<string, unknown>;
      const selected = answerObject.selected;
      if (Array.isArray(selected)) {
        for (let i = 0; i < selected.length; i += 1) {
          const value = selected[i];
          if (typeof value !== "string" || byteLength(value) <= maxBytes) continue;
          selected[i] = truncateToByteLimit(value, maxBytes);
          summary.counts.user_query_answer_truncated =
            (summary.counts.user_query_answer_truncated ?? 0) + 1;
          if (summary.samples.length < maxSamples) {
            summary.samples.push({
              patternId: "user_query_answer_truncated",
              location: `records[${index}].payload.answers.${questionId}.selected[${i}]`,
              before: `${value.length} chars`,
              after: `${(selected[i] as string).length} chars`,
            });
          }
        }
      }
      const other = answerObject.other;
      if (typeof other !== "string" || byteLength(other) <= maxBytes) continue;
      answerObject.other = truncateToByteLimit(other, maxBytes);
      summary.counts.user_query_answer_truncated =
        (summary.counts.user_query_answer_truncated ?? 0) + 1;
      if (summary.samples.length < maxSamples) {
        summary.samples.push({
          patternId: "user_query_answer_truncated",
          location: `records[${index}].payload.answers.${questionId}.other`,
          before: `${other.length} chars`,
          after: `${(answerObject.other as string).length} chars`,
        });
      }
    }
  }
}
