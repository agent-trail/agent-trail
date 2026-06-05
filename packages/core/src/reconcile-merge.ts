import { canonicalizeRecords, stampTrail } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { parseFidelityForEvents } from "./parse-fidelity.ts";
import {
  effectiveSeq,
  findHeader,
  isObject,
  isOpenStream,
  segmentPrevHash,
  shallowEqual,
  stringField,
  synthesizeRecord,
} from "./reconcile-records.ts";
import type { ReconcileGroup, ReconcileWarning, SegmentInput } from "./reconcile-types.ts";

// Header field merge policy for `buildMergedHeader`:
//   STABLE_FIELDS         — explicit override list: prefer the first segment's value.
//   LATE_BINDING_FIELDS   — enumerated for spec parity (matches spec §8.5 step 6); has no
//                           runtime effect because the `lastHeader` spread in
//                           `buildMergedHeader` already inherits these.
//   All other fields      — late-bind by default via the spread (agent, source, etc).
const STABLE_FIELDS = ["id", "type", "schema_version", "session_uid"] as const;
const LATE_BINDING_FIELDS = ["stream", "content_hash", "vcs", "cwd", "meta"] as const;

export function mergeGroup(sessionUid: string, members: SegmentInput[]): ReconcileGroup {
  const warnings: ReconcileWarning[] = [];
  // Sort by segment.seq ascending; segments without `segment` sort as seq=1.
  // Tie-break by `source` lexicographically so duplicate-seq groupings stay
  // stable regardless of caller-supplied input order.
  const sorted = [...members].sort((a, b) => {
    const seqDelta = effectiveSeq(a) - effectiveSeq(b);
    if (seqDelta !== 0) return seqDelta;
    return a.source.localeCompare(b.source);
  });

  // Detect gaps + duplicates in seq.
  let expected = 1;
  for (const member of sorted) {
    const seq = effectiveSeq(member);
    if (seq === expected) {
      expected = seq + 1;
      continue;
    }
    if (seq > expected) {
      warnings.push({
        code: "segment_seq_gap",
        message: `segment.seq gap: expected ${expected}, found ${seq} in ${member.source}`,
        source: member.source,
        detail: { expected, found: seq },
      });
      expected = seq + 1;
      continue;
    }
    // seq < expected -> duplicate or out-of-order
    warnings.push({
      code: "segment_seq_duplicate",
      message: `segment.seq=${seq} repeats or precedes prior segment in ${member.source}`,
      source: member.source,
      detail: { found: seq, expected },
    });
  }

  // Chain verification + dedup + merge.
  const mergedEvents: JsonlRecord[] = [];
  const seenEventIds = new Set<string>();
  let eventsDeduped = 0;
  let prevContentHash: string | null | undefined;

  // Track stable-field divergence across segment headers.
  const firstHeader = findHeader(sorted[0]?.records ?? []);

  for (const [i, member] of sorted.entries()) {
    const header = findHeader(member.records);
    if (header === undefined) continue; // already warned at group time

    if (i > 0) {
      const chainHash = segmentPrevHash(header);
      if (chainHash === null) {
        warnings.push({
          code: "segment_chain_unverifiable",
          message: `Segment ${member.source} declares prev_content_hash=null; chain break recorded`,
          source: member.source,
        });
      } else if (chainHash !== undefined && prevContentHash !== undefined) {
        if (chainHash !== prevContentHash) {
          warnings.push({
            code: "segment_chain_mismatch",
            message: `Segment ${member.source} prev_content_hash ${chainHash} does not match prior segment content_hash ${prevContentHash}`,
            source: member.source,
            detail: { expected: prevContentHash, found: chainHash },
          });
        }
      } else if (chainHash !== undefined && prevContentHash === undefined) {
        // Prior segment did not finalize a content_hash; the chain claim cannot
        // be verified (segment finalization is expected to stamp the hash).
        warnings.push({
          code: "segment_chain_unverifiable",
          message: `Segment ${member.source} declares prev_content_hash but prior segment has no content_hash to compare against`,
          source: member.source,
        });
      }
    }

    // Stable-field divergence check.
    if (firstHeader !== undefined && i > 0) {
      for (const field of STABLE_FIELDS) {
        const first = firstHeader[field];
        const here = header[field];
        if (first !== undefined && here !== undefined && !shallowEqual(first, here)) {
          warnings.push({
            code: "stable_field_divergence",
            message: `Segment ${member.source} ${field} differs from first segment`,
            source: member.source,
            detail: { field, first, here },
          });
        }
      }
    }

    const isFinal = i === sorted.length - 1;
    for (const record of member.records) {
      const value = record.value;
      const type = value.type;
      if (type === "trail" || type === "session") continue;

      // Drop intermediate process_terminated markers; keep terminal one.
      if (
        !isFinal &&
        type === "session_terminated" &&
        isObject(value.payload) &&
        value.payload.reason === "process_terminated"
      ) {
        continue;
      }

      const id = typeof value.id === "string" ? value.id : undefined;
      if (id !== undefined && seenEventIds.has(id)) {
        eventsDeduped += 1;
        continue;
      }
      if (id !== undefined) seenEventIds.add(id);
      mergedEvents.push(record);
    }

    const ch = stringField(header, "content_hash");
    prevContentHash = ch ?? undefined;
  }

  const mergedHeaderRecord = buildMergedHeader(sorted);
  const mergedRecords: JsonlRecord[] = [mergedHeaderRecord, ...mergedEvents];
  const mergedHeaderValue = mergedHeaderRecord.value as Record<string, unknown>;
  mergedHeaderValue.parse_fidelity = parseFidelityForEvents(mergedEvents);
  // The merged trail is a fresh artifact whose canonical bytes differ from
  // any single segment. Re-stamp `content_hash` over the merged bytes so the
  // produced trail validates as a finalized v0.1 trail (spec §7.3).
  //
  // Exception: when the final segment is still streaming (`stream.state ==
  // "open"`), the merged trail inherits the open state and MUST NOT carry a
  // populated `content_hash` (spec §7.3, validator rule
  // `stream_open_with_content_hash`). Skip stamping and strip any inherited
  // hash so the merged open trail stays valid for downstream live-tail use.
  if (isOpenStream(mergedHeaderValue.stream)) {
    delete mergedHeaderValue.content_hash;
    mergedHeaderRecord.raw = JSON.stringify(mergedHeaderValue);
  } else {
    stampTrail(mergedRecords);
  }

  return {
    session_uid: sessionUid,
    records: mergedRecords,
    canonical: canonicalizeRecords(mergedRecords),
    segments: sorted.map((s) => s.source),
    events_deduped: eventsDeduped,
    warnings,
  };
}

function buildMergedHeader(sorted: SegmentInput[]): JsonlRecord {
  const firstHeader = findHeader(sorted[0]?.records ?? []);
  const lastHeader = findHeader(sorted[sorted.length - 1]?.records ?? []);
  if (firstHeader === undefined || lastHeader === undefined) {
    throw new Error("mergeGroup invoked with members missing headers");
  }

  // Start from the highest-seq header (carries latest state), drop segment.*.
  const merged: Record<string, unknown> = { ...lastHeader };
  delete merged.segment;

  // Pull ts from the lowest-seq header so the merged session reflects real start.
  const firstTs = firstHeader.ts;
  if (typeof firstTs === "string") merged.ts = firstTs;

  // Stable fields: prefer first header's value when present (id, schema_version, session_uid).
  for (const field of STABLE_FIELDS) {
    const v = firstHeader[field];
    if (v !== undefined) merged[field] = v;
  }

  // Late-binding fields: already inherited from lastHeader via the spread above.
  // The reference exists for documentation; `void` suppresses the unused-binding
  // warning. Any header field not in STABLE_FIELDS late-binds by the same path.
  void LATE_BINDING_FIELDS;

  return synthesizeRecord(merged, 1);
}
