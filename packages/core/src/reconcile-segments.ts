import { canonicalizeRecords } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { mergeGroup } from "./reconcile-merge.ts";
import { findHeader, segmentSeq, stringField } from "./reconcile-records.ts";
import type {
  ReconcileGroup,
  ReconcileResult,
  ReconcileWarning,
  SegmentInput,
} from "./reconcile-types.ts";
import { splitSessionGroups } from "./session-groups.ts";

export function reconcileSegments(inputs: SegmentInput[]): ReconcileResult {
  const warnings: ReconcileWarning[] = [];
  const groups = new Map<string, SegmentInput[]>();
  // Inputs without a usable session_uid become their own pass-through "group" of one.
  const singletons: SegmentInput[] = [];

  // Pre-split each input into per-session sub-inputs (spec §9.6). A multi-
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
      for (const member of members) {
        outGroups.push(passThrough(member, sessionUid));
      }
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
    // Multi-session file (spec §9.6): each group becomes its own virtual
    // segment input. Envelope is split off and surfaced on the result so
    // callers reconstructing a multi-session output can re-envelope; the
    // reconciler itself operates strictly at session grain.
    if (split.envelope !== null) envelopes.push(split.envelope);
    for (const [i, group] of split.groups.entries()) {
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
