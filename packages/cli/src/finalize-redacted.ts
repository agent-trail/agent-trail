import {
  canonicalizeRecords,
  computeContentHash,
  type JsonlRecord,
  stampTrail,
} from "@agent-trail/core";

export type FinalizedRedactedTrail = {
  canonical: string;
  contentHash: string;
};

/**
 * Finalize a redacted trail for transport. Redaction may mutate headers and
 * re-pin `content_hash` to `<pending>`; this helper re-runs spec §7.4
 * two-pass stamping (session-level first, file-level when an envelope is
 * present) and produces the canonical JSONL bytes the upload layer needs.
 *
 * Returns the canonical bytes ready to gzip+upload and the session-level
 * content hash. The `computeContentHash` fallback covers the pathological
 * case where the record set lacks a stampable session header — defensive
 * rather than load-bearing.
 */
export function finalizeRedactedTrail(records: JsonlRecord[]): FinalizedRedactedTrail {
  const { sessionHash } = stampTrail(records);
  const contentHash = sessionHash ?? computeContentHash(records);
  const canonical = canonicalizeRecords(records);
  return { canonical, contentHash };
}
