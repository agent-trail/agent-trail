/**
 * Public reconciler facade for multi-segment trail files (spec §9.5).
 *
 * Input: one or more parsed segment trails belonging to the same source
 * session(s). The implementation groups by `header.session_uid`, sorts by
 * `header.segment.seq`, verifies the `prev_content_hash` chain, dedups events
 * by `id`, drops intermediate `session_terminated{process_terminated}`
 * markers, and emits one merged trail per source session.
 *
 * Single-segment trails (`segment` absent or `{seq:1}` with no peer carrying
 * the same `session_uid`) pass through unchanged.
 */

export { reconcileSegments } from "./reconcile-segments.ts";
export type {
  ReconcileGroup,
  ReconcileResult,
  ReconcileWarning,
  ReconcileWarningCode,
  SegmentInput,
} from "./reconcile-types.ts";
