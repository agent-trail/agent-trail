import { createHash } from "node:crypto";
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
//   LATE_BINDING_FIELDS   — enumerated for spec parity (matches spec §9.5 step 6); has no
//                           runtime effect because the `lastHeader` spread in
//                           `buildMergedHeader` already inherits these.
//   All other fields      — late-bind by default via the spread (agent, source, etc).
const STABLE_FIELDS = ["id", "type", "schema_version", "session_uid"] as const;
const LATE_BINDING_FIELDS = [
  "stream",
  "content_hash",
  "vcs",
  "cwd",
  "name",
  "description",
  "tags",
  "meta",
] as const;
const HEADER_METADATA_FIELDS = ["name", "description", "tags"] as const;
type HeaderMetadataField = (typeof HEADER_METADATA_FIELDS)[number];

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
  let latestSegmentEventStartIndex = 0;

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
    if (isFinal) latestSegmentEventStartIndex = mergedEvents.length;
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
      mergedEvents.push(cloneRecord(record));
    }

    const ch = stringField(header, "content_hash");
    prevContentHash = ch ?? undefined;
  }

  const mergedHeaderRecord = buildMergedHeader(sorted);
  const mergedHeaderValue = mergedHeaderRecord.value as Record<string, unknown>;
  appendHeaderMetadataReplayCorrections(
    mergedHeaderValue,
    mergedEvents,
    seenEventIds,
    sessionUid,
    latestSegmentEventStartIndex,
  );
  const mergedRecords: JsonlRecord[] = [mergedHeaderRecord, ...mergedEvents];
  renumberMergedRecords(mergedRecords);
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

function renumberMergedRecords(records: JsonlRecord[]): void {
  for (const [index, record] of records.entries()) {
    record.line = index + 1;
  }
}

function cloneRecord(record: JsonlRecord): JsonlRecord {
  return { line: record.line, raw: record.raw, value: record.value };
}

function appendHeaderMetadataReplayCorrections(
  header: Record<string, unknown>,
  events: JsonlRecord[],
  seenEventIds: Set<string>,
  sessionUid: string,
  insertionIndex: number,
): void {
  const effective: Partial<Record<HeaderMetadataField, string | string[]>> = {};
  for (const field of HEADER_METADATA_FIELDS) {
    const value = metadataValueForField(field, header[field]);
    if (value !== undefined) effective[field] = value;
  }

  for (const record of events.slice(0, insertionIndex)) {
    const value = record.value;
    if (value.type !== "session_metadata_update" || !isObject(value.payload)) continue;
    const field = value.payload.field;
    if (!isHeaderMetadataField(field)) continue;
    const next = metadataValueForField(field, value.payload.value);
    if (next !== undefined) effective[field] = next;
  }

  let correctionIndex = boundedCorrectionInsertionIndex(events, insertionIndex);
  for (const field of HEADER_METADATA_FIELDS) {
    const target = metadataValueForField(field, header[field]);
    if (target === undefined || shallowEqual(effective[field], target)) continue;
    const previousValue = effective[field];
    const payload: Record<string, unknown> = {
      field,
      value: cloneMetadataValue(target),
      reason: "runtime_inferred",
    };
    if (previousValue !== undefined) payload.previous_value = cloneMetadataValue(previousValue);
    const id = synthesizedMetadataUpdateId(sessionUid, field, target, seenEventIds);
    seenEventIds.add(id);
    events.splice(
      correctionIndex,
      0,
      synthesizeRecord(
        {
          type: "session_metadata_update",
          id,
          ts: latestTimestamp(header, events.slice(0, correctionIndex)),
          payload,
          source: {
            agent: "x-agent-trail/reconciler",
            original_type: "reconcile.header_metadata_late_bind",
            synthesized: true,
          },
        },
        correctionIndex + 2,
      ),
    );
    correctionIndex += 1;
    effective[field] = target;
  }
}

function boundedCorrectionInsertionIndex(events: JsonlRecord[], insertionIndex: number): number {
  return Math.max(0, Math.min(insertionIndex, events.length));
}

function isHeaderMetadataField(value: unknown): value is HeaderMetadataField {
  return value === "name" || value === "description" || value === "tags";
}

function metadataValueForField(
  field: HeaderMetadataField,
  value: unknown,
): string | string[] | undefined {
  if (field === "tags") {
    return Array.isArray(value) && value.every((tag) => typeof tag === "string")
      ? [...value]
      : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function cloneMetadataValue(value: string | string[]): string | string[] {
  return Array.isArray(value) ? [...value] : value;
}

function synthesizedMetadataUpdateId(
  sessionUid: string,
  field: HeaderMetadataField,
  value: string | string[],
  seenEventIds: Set<string>,
): string {
  for (let attempt = 0; ; attempt += 1) {
    const id = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "agent-trail/reconcile-header-metadata",
          sessionUid,
          field,
          value,
          attempt,
        }),
        "utf8",
      )
      .digest("hex")
      .slice(0, 32);
    if (!seenEventIds.has(id)) return id;
  }
}

function latestTimestamp(header: Record<string, unknown>, events: JsonlRecord[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ts = events[i]?.value.ts;
    if (typeof ts === "string") return ts;
  }
  return typeof header.ts === "string" ? header.ts : "1970-01-01T00:00:00.000Z";
}
