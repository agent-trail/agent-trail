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
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "tool_result") continue;
    const payload = value.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    const output = payload.output;
    if (typeof output !== "string") continue;
    if (byteLength(output) <= maxBytes) continue;
    const original = output;
    payload.output = truncateToByteLimit(output, maxBytes);
    payload.truncated = true;
    summary.counts.output_truncated = (summary.counts.output_truncated ?? 0) + 1;
    summary.samples.push({
      patternId: "output_truncated",
      location: `records[${index}].payload.output`,
      before: `${original.length} chars`,
      after: `${(payload.output as string).length} chars`,
    });
  }
}
