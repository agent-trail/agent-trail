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

export function computeContentHash(records: JsonlRecord[]): string {
  const lines: string[] = [];
  for (const [index, record] of records.entries()) {
    const value = index === 0 ? { ...record.value, content_hash: PENDING } : record.value;
    const canonical = canonicalize(value);
    if (canonical === undefined) {
      throw new TypeError(`Cannot canonicalize record on line ${record.line}`);
    }
    lines.push(canonical);
  }

  return createHash("sha256")
    .update(`${lines.join("\n")}\n`, "utf8")
    .digest("hex");
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
