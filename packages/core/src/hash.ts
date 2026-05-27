import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { JsonlRecord } from "./jsonl.ts";
import { splitSessionGroups } from "./session-groups.ts";

export type ComputeContentHashOptions = {
  /**
   * Which session group to hash in a multi-session file (spec §8.6).
   * Defaults to 0 (the first group), preserving the single-session contract.
   */
  groupIndex?: number;
};

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
 * Internal: canonical JSONL bytes used to compute or verify a `content_hash`,
 * per spec §7.3 step 1: same as {@link canonicalizeRecords} but with the
 * record matching `recordType` ("session" or "trail") having its
 * `content_hash` field replaced by the literal `"<pending>"`. The hash is
 * computed over these bytes; finalized disk bytes are produced by
 * {@link canonicalizeRecords} after the pinned record is stamped with the
 * resulting hex digest.
 *
 * Not exported because the caller must already understand the spec §7.4
 * two-tier identity (pin the session record vs the trail envelope record)
 * and the per-callsite stamp order. External callers should go through
 * {@link computeContentHash}, {@link computeTrailEnvelopeContentHash},
 * {@link verifyContentHash}, or {@link stampTrail}, all of which apply the
 * correct pinning and slicing.
 */
function canonicalizeRecordsForHashing(
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
 *
 * For writers that also need to stamp the digest into the session header,
 * prefer {@link stampTrail}: it enforces the spec §7.4 two-pass stamp order
 * (session-level hash before file-level hash) so the envelope hash, when
 * present, is computed against the finalized session hash rather than
 * `<pending>`.
 */
export function computeContentHash(
  records: JsonlRecord[],
  options: ComputeContentHashOptions = {},
): string {
  const slice = sliceSessionGroup(records, options.groupIndex ?? 0);
  return createHash("sha256")
    .update(canonicalizeRecordsForHashing(slice, "session"), "utf8")
    .digest("hex");
}

/**
 * Records covering exactly one session group (header + its events) for hashing.
 * Multi-session files (spec §8.6): each group's session-level hash is computed
 * over only its own slice, so an extracted single-session file recomputes the
 * same digest as the in-file value.
 *
 * Slicing uses `group.startLine` / `group.endLineExclusive` rather than object
 * reference identity so callers that pass a copied or re-serialized record
 * list still hash the correct slice.
 */
function sliceSessionGroup(records: JsonlRecord[], groupIndex: number): JsonlRecord[] {
  const split = splitSessionGroups(records);
  const group = split.groups[groupIndex];
  if (group === undefined) {
    return records;
  }
  return records.filter((r) => r.line >= group.startLine && r.line < group.endLineExclusive);
}

/**
 * SHA-256 of the canonical bytes covering the entire file with the trail
 * envelope's `content_hash` pinned to `<pending>`. The session header's
 * already-stamped `content_hash` is treated as opaque file content
 * (spec §7.4).
 *
 * The session-level `content_hash` MUST already be stamped before calling
 * this; otherwise the envelope hash will be computed over the literal
 * `<pending>` and will not match the eventual finalized session hash.
 * Prefer {@link stampTrail}, which performs both passes in the spec §7.4
 * order so this misuse is impossible by construction.
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
  /** Session-level digests in file order, one per `(session header, events*)` group (spec §8.6). */
  sessionHashes: string[];
  envelopeHash: string | null;
};

/**
 * Spec §7.4 two-pass stamping: mutate the records in place so every session
 * header's `content_hash` is its session-level digest and (when an envelope
 * is present) the envelope's `content_hash` is the file-level digest. Multi-
 * session files (spec §8.6) stamp each group's hash before the envelope hash.
 *
 * Callers that already manage stamping order may continue to use
 * {@link computeContentHash} and {@link computeTrailEnvelopeContentHash}
 * directly; this helper exists so writers cannot accidentally stamp the
 * file-level hash before the session-level hashes.
 */
export function stampTrail(records: JsonlRecord[]): StampTrailResult {
  const split = splitSessionGroups(records);
  const sessionHashes: string[] = [];
  for (let i = 0; i < split.groups.length; i += 1) {
    const group = split.groups[i] as { header: JsonlRecord };
    const digest = computeContentHash(records, { groupIndex: i });
    (group.header.value as { content_hash?: string }).content_hash = digest;
    group.header.raw = JSON.stringify(group.header.value);
    sessionHashes.push(digest);
  }
  let envelopeHash: string | null = null;
  if (split.envelope !== null) {
    envelopeHash = computeTrailEnvelopeContentHash(records);
    if (envelopeHash !== null) {
      (split.envelope.value as { content_hash?: string }).content_hash = envelopeHash;
      split.envelope.raw = JSON.stringify(split.envelope.value);
    }
  }
  return { sessionHashes, envelopeHash };
}

export function verifyContentHash(
  records: JsonlRecord[],
  options: ComputeContentHashOptions = {},
): VerifyContentHashResult {
  const split = splitSessionGroups(records);
  const groupIndex = options.groupIndex ?? 0;
  const group = split.groups[groupIndex];
  if (group === undefined) {
    return { status: "missing", expected: null, actual: null };
  }
  const slice = sliceSessionGroup(records, groupIndex);
  return verifyAt(slice, "session", group.header);
}

/**
 * Verify the session-level `content_hash` of every group in a multi-session
 * file (spec §8.6). Returns one result per group in file order.
 */
export function verifyAllSessionContentHashes(records: JsonlRecord[]): VerifyContentHashResult[] {
  const split = splitSessionGroups(records);
  return split.groups.map((_, index) => verifyContentHash(records, { groupIndex: index }));
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
