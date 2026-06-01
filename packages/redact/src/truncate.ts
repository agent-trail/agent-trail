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

function serializedByteLength(value: unknown): number {
  return byteLength(typeof value === "string" ? value : JSON.stringify(value));
}

function addMutationCount(
  counts: Map<number, number> | undefined,
  recordIndex: number,
  count: number,
): void {
  if (counts === undefined || count <= 0) return;
  counts.set(recordIndex, (counts.get(recordIndex) ?? 0) + count);
}

function truncateUserInputAnswersMeta(
  payload: Record<string, unknown>,
  recordIndex: number,
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
): void {
  const meta = payload.meta;
  if (meta === null || typeof meta !== "object") return;
  const userInput = (meta as Record<string, unknown>).user_input_request;
  if (userInput === null || typeof userInput !== "object") return;
  const answerMeta = userInput as Record<string, unknown>;
  if (!("answers" in answerMeta)) return;
  const answers = answerMeta.answers;
  if (answers === undefined) return;
  if (serializedByteLength(answers) <= maxBytes) return;
  const serialized = typeof answers === "string" ? answers : JSON.stringify(answers);
  answerMeta.answers = truncateToByteLimit(serialized, maxBytes);
  addMutationCount(mutationCounts, recordIndex, 1);
  summary.counts.meta_truncated = (summary.counts.meta_truncated ?? 0) + 1;
  if (summary.samples.length < maxSamples) {
    summary.samples.push({
      patternId: "meta_truncated",
      location: `records[${recordIndex}].payload.meta.user_input_request.answers`,
      before: `${serialized.length} chars`,
      after: `${(answerMeta.answers as string).length} chars`,
    });
  }
}

export function truncateOutputs(
  records: JsonlRecord[],
  maxBytes: number,
  summary: RedactionSummary,
  maxSamples: number,
  mutationCounts?: Map<number, number>,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "tool_result") continue;
    const payload = value.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    truncateUserInputAnswersMeta(payload, index, maxBytes, summary, maxSamples, mutationCounts);
    const output = payload.output;
    if (typeof output !== "string") continue;
    if (byteLength(output) <= maxBytes) continue;
    const original = output;
    payload.output_size = byteLength(original);
    payload.output = truncateToByteLimit(output, maxBytes);
    payload.truncated = true;
    addMutationCount(mutationCounts, index, 1);
    summary.counts.output_truncated = (summary.counts.output_truncated ?? 0) + 1;
    if (summary.samples.length < maxSamples) {
      summary.samples.push({
        patternId: "output_truncated",
        location: `records[${index}].payload.output`,
        before: `${original.length} chars`,
        after: `${(payload.output as string).length} chars`,
      });
    }
  }
}
