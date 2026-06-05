import type { JsonlRecord } from "@agent-trail/core";
import { byteLength } from "./rules.ts";

export function addMutationCount(
  counts: Map<number, number>,
  recordIndex: number,
  count: number,
): void {
  if (count <= 0) return;
  counts.set(recordIndex, (counts.get(recordIndex) ?? 0) + count);
}

export function snapshotToolResultOutputSizes(records: JsonlRecord[]): Map<number, number> {
  const sizes = new Map<number, number>();
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "tool_result") continue;
    const payload = value.payload as Record<string, unknown> | undefined;
    if (typeof payload?.output === "string") {
      sizes.set(index, byteLength(payload.output));
    }
  }
  return sizes;
}

export function applyRedactionCounts(
  records: JsonlRecord[],
  counts: ReadonlyMap<number, number>,
): void {
  for (const [index, count] of counts) {
    const value = records[index]?.value as Record<string, unknown> | undefined;
    if (value === undefined || value.type === "session" || value.type === "trail") continue;
    const meta =
      value.meta !== null && typeof value.meta === "object"
        ? (value.meta as Record<string, unknown>)
        : {};
    const previous =
      typeof meta.redaction_count === "number" &&
      Number.isInteger(meta.redaction_count) &&
      meta.redaction_count >= 0
        ? meta.redaction_count
        : 0;
    value.meta = { ...meta, redaction_count: previous + count };
  }
}
