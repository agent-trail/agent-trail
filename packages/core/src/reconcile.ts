import { canonicalizeRecords, stampTrail } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";

/**
 * Reconciler for multi-segment trail files (spec §8.5).
 *
 * Input: one or more parsed segment trails belonging to the same source
 * session(s). Reconciler groups by `header.session_uid`, sorts by
 * `header.segment.seq`, verifies the `prev_content_hash` chain, dedups
 * events by `id`, drops intermediate `session_terminated{process_terminated}`
 * markers, and emits one merged trail per source session.
 *
 * Single-segment trails (`segment` absent or `{seq:1}` with no peer carrying
 * the same `session_uid`) pass through unchanged.
 */

export type SegmentInput = {
  /** Stable label for diagnostics, typically a file path or store key. */
  source: string;
  /** Parsed records of one segment trail (envelope optional, header at line 1 or 2, events follow). */
  records: JsonlRecord[];
};

export type ReconcileWarningCode =
  | "missing_session_uid"
  | "segment_chain_mismatch"
  | "segment_chain_unverifiable"
  | "segment_seq_gap"
  | "segment_seq_duplicate"
  | "stable_field_divergence"
  | "missing_session_header";

export type ReconcileWarning = {
  code: ReconcileWarningCode;
  message: string;
  source?: string;
  detail?: Record<string, unknown>;
};

export type ReconcileGroup = {
  /** session_uid that groups these segments. `null` for single-segment inputs lacking session_uid. */
  session_uid: string | null;
  /** Merged records in JSONL order (envelope?, header, events…). */
  records: JsonlRecord[];
  /** Canonical JSONL bytes (`canonicalizeRecords(records)`). */
  canonical: string;
  /** Source labels in the order they were merged (sorted by segment.seq when present). */
  segments: string[];
  /** Number of events skipped because their id already appeared in an earlier segment. */
  events_deduped: number;
  /** Warnings scoped to this merge group. */
  warnings: ReconcileWarning[];
};

export type ReconcileResult = {
  groups: ReconcileGroup[];
  /** Warnings that do not belong to a particular group (e.g., input shape). */
  warnings: ReconcileWarning[];
};

type Header = {
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

// Header field merge policy for `buildMergedHeader`:
//   STABLE_FIELDS         — explicit override list: prefer the first segment's value.
//   LATE_BINDING_FIELDS   — enumerated for spec parity (matches spec §8.5 step 6); has no
//                           runtime effect because the `lastHeader` spread on line 293
//                           already inherits these. Kept as documentation.
//   All other fields      — late-bind by default via the spread (agent, source, etc).
const STABLE_FIELDS = ["id", "type", "schema_version", "session_uid"] as const;
const LATE_BINDING_FIELDS = ["stream", "content_hash", "vcs", "cwd", "meta"] as const;

export function reconcileSegments(inputs: SegmentInput[]): ReconcileResult {
  const warnings: ReconcileWarning[] = [];
  const groups = new Map<string, SegmentInput[]>();
  // Inputs without a usable session_uid become their own pass-through "group" of one.
  const singletons: SegmentInput[] = [];

  for (const input of inputs) {
    const header = findHeader(input.records);
    if (header === undefined) {
      warnings.push({
        code: "missing_session_header",
        message: `Input ${input.source} has no session header; skipped`,
        source: input.source,
      });
      continue;
    }
    const sessionUid = stringField(header, "session_uid");
    const seq = segmentSeq(header);
    if (sessionUid === undefined) {
      if (seq !== undefined && seq >= 2) {
        warnings.push({
          code: "missing_session_uid",
          message: `Input ${input.source} has segment.seq=${seq} but no session_uid; cannot group`,
          source: input.source,
        });
      }
      singletons.push(input);
      continue;
    }
    const bucket = groups.get(sessionUid);
    if (bucket === undefined) {
      groups.set(sessionUid, [input]);
    } else {
      bucket.push(input);
    }
  }

  const outGroups: ReconcileGroup[] = [];

  for (const input of singletons) {
    outGroups.push(passThrough(input, null));
  }

  for (const [sessionUid, members] of groups) {
    if (members.length === 1) {
      outGroups.push(passThrough(members[0] as SegmentInput, sessionUid));
      continue;
    }
    outGroups.push(mergeGroup(sessionUid, members));
  }

  return { groups: outGroups, warnings };
}

function passThrough(input: SegmentInput, sessionUid: string | null): ReconcileGroup {
  return {
    session_uid: sessionUid,
    records: input.records,
    canonical: canonicalizeRecords(input.records),
    segments: [input.source],
    events_deduped: 0,
    warnings: [],
  };
}

function mergeGroup(sessionUid: string, members: SegmentInput[]): ReconcileGroup {
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
    // seq < expected → duplicate or out-of-order
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

  for (let i = 0; i < sorted.length; i++) {
    const member = sorted[i] as SegmentInput;
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
        const first = (firstHeader as Record<string, unknown>)[field];
        const here = (header as Record<string, unknown>)[field];
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

    const ch = stringField(header as Record<string, unknown>, "content_hash");
    prevContentHash = ch ?? undefined;
  }

  const mergedHeaderRecord = buildMergedHeader(sorted);
  const mergedRecords: JsonlRecord[] = [mergedHeaderRecord, ...mergedEvents];
  // The merged trail is a fresh artifact whose canonical bytes differ from
  // any single segment. Re-stamp `content_hash` over the merged bytes so the
  // produced trail validates as a finalized v0.1 trail (spec §7.3).
  //
  // Exception: when the final segment is still streaming (`stream.state ==
  // "open"`), the merged trail inherits the open state and MUST NOT carry a
  // populated `content_hash` (spec §7.3, validator rule
  // `stream_open_with_content_hash`). Skip stamping and strip any inherited
  // hash so the merged open trail stays valid for downstream live-tail use.
  const mergedHeaderValue = mergedHeaderRecord.value as Record<string, unknown>;
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
  const merged: Record<string, unknown> = { ...(lastHeader as Record<string, unknown>) };
  delete merged.segment;

  // Pull ts from the lowest-seq header so the merged session reflects real start.
  const firstTs = (firstHeader as Record<string, unknown>).ts;
  if (typeof firstTs === "string") merged.ts = firstTs;

  // Stable fields: prefer first header's value when present (id, schema_version, session_uid).
  for (const field of STABLE_FIELDS) {
    const v = (firstHeader as Record<string, unknown>)[field];
    if (v !== undefined) merged[field] = v;
  }

  // Late-binding fields: already inherited from lastHeader via the spread above.
  // The reference exists for documentation; `void` suppresses the unused-binding
  // warning. Any header field not in STABLE_FIELDS late-binds by the same path.
  void LATE_BINDING_FIELDS;

  return synthesizeRecord(merged, 1);
}

function synthesizeRecord(value: Record<string, unknown>, line: number): JsonlRecord {
  return { line, raw: JSON.stringify(value), value };
}

function findHeader(records: JsonlRecord[]): Header | undefined {
  for (const record of records) {
    if (record.value.type === "session") return record.value as Header;
  }
  return undefined;
}

function effectiveSeq(input: SegmentInput): number {
  const header = findHeader(input.records);
  if (header === undefined) return 1;
  const seq = segmentSeq(header);
  return seq ?? 1;
}

function segmentSeq(header: Header): number | undefined {
  const seg = header.segment;
  if (!isObject(seg)) return undefined;
  const seq = (seg as Record<string, unknown>).seq;
  return typeof seq === "number" && Number.isFinite(seq) ? seq : undefined;
}

function segmentPrevHash(header: Header): string | null | undefined {
  const seg = header.segment;
  if (!isObject(seg)) return undefined;
  const v = (seg as Record<string, unknown>).prev_content_hash;
  if (v === null) return null;
  if (typeof v === "string") return v;
  return undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const v = value[key];
  return typeof v === "string" ? v : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOpenStream(stream: unknown): boolean {
  return isObject(stream) && (stream as Record<string, unknown>).state === "open";
}

function shallowEqual(a: unknown, b: unknown): boolean {
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
