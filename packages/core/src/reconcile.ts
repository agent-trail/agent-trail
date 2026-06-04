import { canonicalizeRecords } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { mergeGroup } from "./reconcile-merge.ts";
import { findHeader, segmentSeq, stringField } from "./reconcile-records.ts";
import { splitSessionGroups } from "./session-groups.ts";

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
  /**
   * Trail envelopes carried by multi-session inputs (spec §8.6). Reconciler
   * operates at session grain, so envelopes are split off rather than merged.
   * Callers reconstructing a multi-session output file may re-envelope using
   * one of these records (the first non-null when present), but must
   * recompute the envelope-level `content_hash` since the merged file's bytes
   * differ. Empty when every input was a single-session, envelope-less trail.
   */
  envelopes: JsonlRecord[];
};

export function reconcileSegments(inputs: SegmentInput[]): ReconcileResult {
  const warnings: ReconcileWarning[] = [];
  const groups = new Map<string, SegmentInput[]>();
  // Inputs without a usable session_uid become their own pass-through "group" of one.
  const singletons: SegmentInput[] = [];

  // Pre-split each input into per-session sub-inputs (spec §8.6). A multi-
  // session file feeds N virtual SegmentInputs sharing the parent source
  // label but partitioned by `(header, events)` group. This lets the existing
  // group-by-session_uid algorithm operate uniformly across single-session
  // peers and multi-session files. Envelopes are captured separately on the
  // result so callers can re-envelope downstream.
  const { inputs: splitInputs, envelopes } = explodeMultiSessionInputs(inputs);

  for (const input of splitInputs) {
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

  return { groups: outGroups, warnings, envelopes };
}

function explodeMultiSessionInputs(inputs: SegmentInput[]): {
  inputs: SegmentInput[];
  envelopes: JsonlRecord[];
} {
  const out: SegmentInput[] = [];
  const envelopes: JsonlRecord[] = [];
  for (const input of inputs) {
    const split = splitSessionGroups(input.records);
    if (split.groups.length <= 1) {
      // Single-session file (or no header). Pass through as-is so any
      // envelope record is preserved for downstream canonicalization.
      out.push(input);
      continue;
    }
    // Multi-session file (spec §8.6): each group becomes its own virtual
    // segment input. Envelope is split off and surfaced on the result so
    // callers reconstructing a multi-session output can re-envelope; the
    // reconciler itself operates strictly at session grain.
    if (split.envelope !== null) envelopes.push(split.envelope);
    for (let i = 0; i < split.groups.length; i += 1) {
      const group = split.groups[i] as { header: JsonlRecord; entries: JsonlRecord[] };
      out.push({
        source: `${input.source}#session-${i}`,
        records: [group.header, ...group.entries],
      });
    }
  }
  return { inputs: out, envelopes };
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
