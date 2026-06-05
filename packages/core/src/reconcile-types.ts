import type { JsonlRecord } from "./jsonl.ts";

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
