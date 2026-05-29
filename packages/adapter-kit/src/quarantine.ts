import type { AgentName, Entry } from "@agent-trail/types";
import type { RawRecord } from "./readers/types.ts";

export interface QuarantineInput {
  /** Trail agent name, recorded on `source.agent`. */
  agent: AgentName;
  /** Vendor namespace for the event kind (`x-<namespace>/unknown_record`). */
  namespace: string;
  id: string;
  ts: string;
  /** The raw source record that matched no known schema version. */
  record: RawRecord;
  /** Source record type, recorded on `source.original_type`. Defaults to `record.type`. */
  originalType?: string;
}

/**
 * Wrap a source record that failed source-schema validation as a lossless
 * `system_event`. Drift becomes a visible, countable trail entry
 * (`x-<namespace>/unknown_record`) carrying the raw payload under
 * `payload.data.raw`, instead of a silent drop or a mid-session crash.
 */
export function quarantine(input: QuarantineInput): Entry {
  const originalType =
    input.originalType ?? (typeof input.record.type === "string" ? input.record.type : undefined);
  return {
    type: "system_event",
    id: input.id,
    ts: input.ts,
    payload: {
      kind: `x-${input.namespace}/unknown_record`,
      data: { raw: input.record },
    },
    source: {
      agent: input.agent,
      original_type: originalType,
      synthesized: true,
    },
  };
}
