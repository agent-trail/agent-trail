import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { JsonlRecord } from "./jsonl.ts";

const PENDING = "<pending>";
const HEX_64 = /^[0-9a-f]{64}$/;

export type ContentHashStatus = "match" | "mismatch" | "pending" | "missing" | "invalid";

export type VerifyContentHashResult = {
  status: ContentHashStatus;
  expected: string | null;
  actual: string | null;
};

/**
 * Canonical JSONL bytes for the trail, per spec §7.3:
 * each record JCS-canonicalized, LF-joined, trailing newline.
 * The header keeps whatever `content_hash` value it carries (real hex,
 * `<pending>`, or absent). These are the bytes written to disk for a
 * finalized artifact.
 */
export function canonicalizeRecords(records: JsonlRecord[]): string {
  const lines: string[] = [];
  for (const record of records) {
    const canonical = canonicalize(record.value);
    if (canonical === undefined) {
      throw new TypeError(`Cannot canonicalize record on line ${record.line}`);
    }
    lines.push(canonical);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Canonical JSONL bytes used to compute or verify `content_hash`, per
 * spec §7.3 step 1: same as {@link canonicalizeRecords} but with the
 * header's `content_hash` field replaced by the literal `"<pending>"`.
 * The hash is computed over these bytes; the bytes written to disk are
 * produced by {@link canonicalizeRecords} after the header is stamped
 * with the resulting hex digest.
 */
export function canonicalizeRecordsForHashing(records: JsonlRecord[]): string {
  const lines: string[] = [];
  for (const [index, record] of records.entries()) {
    const value = index === 0 ? { ...record.value, content_hash: PENDING } : record.value;
    const canonical = canonicalize(value);
    if (canonical === undefined) {
      throw new TypeError(`Cannot canonicalize record on line ${record.line}`);
    }
    lines.push(canonical);
  }
  return `${lines.join("\n")}\n`;
}

export function computeContentHash(records: JsonlRecord[]): string {
  return createHash("sha256").update(canonicalizeRecordsForHashing(records), "utf8").digest("hex");
}

export function verifyContentHash(records: JsonlRecord[]): VerifyContentHashResult {
  const headerRecord = records[0];
  if (headerRecord === undefined || headerRecord.value.type !== "session") {
    return { status: "missing", expected: null, actual: null };
  }

  const expected = headerRecord.value.content_hash;
  if (expected === undefined) {
    return { status: "missing", expected: null, actual: null };
  }
  if (typeof expected !== "string") {
    return { status: "invalid", expected: null, actual: null };
  }
  if (expected === PENDING) {
    return { status: "pending", expected, actual: null };
  }
  if (!HEX_64.test(expected)) {
    return { status: "invalid", expected, actual: null };
  }

  const actual = computeContentHash(records);
  return {
    status: actual === expected ? "match" : "mismatch",
    expected,
    actual,
  };
}
