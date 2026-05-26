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
 * Records keep whatever `content_hash` values they carry (real hex,
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
 * Canonical JSONL bytes used to compute or verify a `content_hash`, per
 * spec §7.3 step 1: same as {@link canonicalizeRecords} but with the
 * record matching `recordType` ("session" or "trail") having its
 * `content_hash` field replaced by the literal `"<pending>"`. The hash is
 * computed over these bytes; finalized disk bytes are produced by
 * {@link canonicalizeRecords} after the pinned record is stamped with the
 * resulting hex digest.
 *
 * Spec §7.4 two-tier identity: when hashing the session ("session"), pass
 * the session-slice only — envelope bytes do not contribute. When hashing
 * the file-level envelope ("trail"), pass the full records array; the
 * session header's already-stamped `content_hash` is treated as opaque
 * file content.
 */
export function canonicalizeRecordsForHashing(
  records: JsonlRecord[],
  recordType: "session" | "trail" = "session",
): string {
  const pinIndex = findRecordIndex(records, recordType);
  const lines: string[] = [];
  for (const [index, record] of records.entries()) {
    const value = index === pinIndex ? { ...record.value, content_hash: PENDING } : record.value;
    const canonical = canonicalize(value);
    if (canonical === undefined) {
      throw new TypeError(`Cannot canonicalize record on line ${record.line}`);
    }
    lines.push(canonical);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * SHA-256 of the canonical bytes covering ONLY the session header and its
 * events, with the session header's `content_hash` pinned to `<pending>`.
 * Envelope records (when present) are excluded so the session's identity is
 * independent of whether the file carries a trail envelope.
 */
export function computeContentHash(records: JsonlRecord[]): string {
  const sessionIndex = findRecordIndex(records, "session");
  const sliceFrom = sessionIndex === -1 ? 0 : sessionIndex;
  const slice = records.slice(sliceFrom);
  return createHash("sha256")
    .update(canonicalizeRecordsForHashing(slice, "session"), "utf8")
    .digest("hex");
}

/**
 * SHA-256 of the canonical bytes covering the entire file with the trail
 * envelope's `content_hash` pinned to `<pending>`. The session header's
 * already-stamped `content_hash` is treated as opaque file content
 * (spec §7.4). Writers MUST stamp the session-level hash first via
 * {@link computeContentHash}, then compute this file-level hash; use
 * {@link stampTrail} to perform both in the correct order.
 *
 * Returns null when there is no envelope at line 1.
 */
export function computeTrailEnvelopeContentHash(records: JsonlRecord[]): string | null {
  const envelopeIndex = trailEnvelopeIndex(records);
  if (envelopeIndex === -1) {
    return null;
  }
  return createHash("sha256")
    .update(canonicalizeRecordsForHashing(records, "trail"), "utf8")
    .digest("hex");
}

export type StampTrailResult = {
  sessionHash: string | null;
  envelopeHash: string | null;
};

/**
 * Spec §7.4 two-pass stamping: mutate the records in place so the session
 * header's `content_hash` is the session-level digest and (when an envelope
 * is present) the envelope's `content_hash` is the file-level digest.
 * Returns the digests for convenience.
 *
 * Callers that already manage stamping order may continue to use
 * {@link computeContentHash} and {@link computeTrailEnvelopeContentHash}
 * directly; this helper exists so writers cannot accidentally stamp the
 * file-level hash before the session-level hash.
 */
export function stampTrail(records: JsonlRecord[]): StampTrailResult {
  const sessionIndex = findRecordIndex(records, "session");
  let sessionHash: string | null = null;
  if (sessionIndex !== -1) {
    sessionHash = computeContentHash(records);
    const sessionRecord = records[sessionIndex];
    if (sessionRecord !== undefined) {
      (sessionRecord.value as { content_hash?: string }).content_hash = sessionHash;
    }
  }
  const envelopeIndex = trailEnvelopeIndex(records);
  let envelopeHash: string | null = null;
  if (envelopeIndex !== -1) {
    envelopeHash = computeTrailEnvelopeContentHash(records);
    const envelopeRecord = records[envelopeIndex];
    if (envelopeHash !== null && envelopeRecord !== undefined) {
      (envelopeRecord.value as { content_hash?: string }).content_hash = envelopeHash;
    }
  }
  return { sessionHash, envelopeHash };
}

export function verifyContentHash(records: JsonlRecord[]): VerifyContentHashResult {
  const sessionIndex = findRecordIndex(records, "session");
  if (sessionIndex === -1) {
    return { status: "missing", expected: null, actual: null };
  }
  const sessionRecord = records[sessionIndex];
  if (sessionRecord === undefined) {
    return { status: "missing", expected: null, actual: null };
  }
  const slice = records.slice(sessionIndex);
  return verifyAt(slice, "session", sessionRecord);
}

/**
 * Verify the file-level (envelope) `content_hash`. Per spec §7.4, this
 * canonicalizes the full record set with the envelope pinned to
 * `<pending>` and treats any already-stamped session-level `content_hash`
 * as opaque file content — verification therefore must run against the
 * finalized records produced by {@link stampTrail} (or the equivalent
 * session-first, envelope-second sequence).
 */
export function verifyTrailEnvelopeContentHash(records: JsonlRecord[]): VerifyContentHashResult {
  const envelopeIndex = trailEnvelopeIndex(records);
  if (envelopeIndex === -1) {
    return { status: "missing", expected: null, actual: null };
  }
  const envelopeRecord = records[envelopeIndex];
  if (envelopeRecord === undefined) {
    return { status: "missing", expected: null, actual: null };
  }
  return verifyAt(records, "trail", envelopeRecord);
}

function verifyAt(
  records: JsonlRecord[],
  recordType: "session" | "trail",
  pinnedRecord: JsonlRecord,
): VerifyContentHashResult {
  const expected = pinnedRecord.value.content_hash;
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

  const actual = createHash("sha256")
    .update(canonicalizeRecordsForHashing(records, recordType), "utf8")
    .digest("hex");
  return {
    status: actual === expected ? "match" : "mismatch",
    expected,
    actual,
  };
}

function trailEnvelopeIndex(records: JsonlRecord[]): number {
  const first = records[0];
  return first !== undefined && first.value.type === "trail" ? 0 : -1;
}

function findRecordIndex(records: JsonlRecord[], recordType: "session" | "trail"): number {
  if (recordType === "trail") {
    return trailEnvelopeIndex(records);
  }
  const first = records[0];
  if (first === undefined) {
    return -1;
  }
  if (first.value.type === "session") {
    return 0;
  }
  if (first.value.type === "trail") {
    const second = records[1];
    if (second !== undefined && second.value.type === "session") {
      return 1;
    }
  }
  return -1;
}
