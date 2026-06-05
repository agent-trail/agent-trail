import type { JsonlRecord } from "./jsonl.ts";
import type { SegmentInput } from "./reconcile-types.ts";

export type ReconcileHeader = {
  type?: unknown;
  id?: unknown;
  ts?: unknown;
  content_hash?: unknown;
  session_uid?: unknown;
  segment?: { seq?: unknown; prev_content_hash?: unknown };
  stream?: unknown;
  cwd?: unknown;
  vcs?: unknown;
  agent?: { name?: unknown; version?: unknown; model_default?: unknown };
  meta?: unknown;
} & Record<string, unknown>;

export function synthesizeRecord(value: Record<string, unknown>, line: number): JsonlRecord {
  return { line, raw: JSON.stringify(value), value };
}

export function findHeader(records: JsonlRecord[]): ReconcileHeader | undefined {
  for (const record of records) {
    if (record.value.type === "session") return record.value as ReconcileHeader;
  }
  return undefined;
}

export function effectiveSeq(input: SegmentInput): number {
  const header = findHeader(input.records);
  if (header === undefined) return 1;
  const seq = segmentSeq(header);
  return seq ?? 1;
}

export function segmentSeq(header: ReconcileHeader): number | undefined {
  const seg = header.segment;
  if (!isObject(seg)) return undefined;
  const seq = seg.seq;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : undefined;
}

export function segmentPrevHash(header: ReconcileHeader): string | null | undefined {
  const seg = header.segment;
  if (!isObject(seg)) return undefined;
  const v = seg.prev_content_hash;
  if (v === null) return null;
  if (typeof v === "string") return v;
  return undefined;
}

export function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const v = value[key];
  return typeof v === "string" ? v : undefined;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isOpenStream(stream: unknown): boolean {
  return isObject(stream) && (stream as Record<string, unknown>).state === "open";
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}
