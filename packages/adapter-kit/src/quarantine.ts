import type { AgentName, Entry } from "@agent-trail/types";
import type { RawRecord } from "./readers/types.ts";
import type { TrailEntryDraft } from "./types.ts";

export interface QuarantineDraftInput {
  /** Trail agent name, recorded on `source.agent`. */
  agent: AgentName;
  /** Vendor namespace for the event kind (`x-<namespace>/unknown_record`). */
  namespace: string;
  /** The raw source record that matched no known schema version. */
  record: RawRecord;
  /** Source record type, recorded on `source.original_type`. Defaults to `record.type`. */
  originalType?: string;
}

export interface QuarantineInput extends QuarantineDraftInput {
  id: string;
  ts: string;
}

/**
 * Wrap a source record that failed source-schema validation as a lossless
 * `system_event`. Drift becomes a visible, countable trail entry
 * (`x-<namespace>/unknown_record`) carrying the raw payload under
 * `payload.data.raw`, instead of a silent drop or a mid-session crash.
 *
 * `payload.data` is exactly `{ raw: <source record> }` — nothing else. The
 * writer-strict schema seals `data` with `additionalProperties: false`, so
 * adding sibling fields here would fail validation. When `record.type` is not
 * a string, `source.original_type` is intentionally omitted (left `undefined`)
 * rather than coerced; these sources always carry a string `type` in practice.
 */
export function quarantine(input: QuarantineInput): Entry {
  const draft = quarantineDraft(input);
  return { ...draft, id: input.id, ts: input.ts } as Entry;
}

/**
 * Build the `system_event` draft for a drift record without an `id`/`ts` —
 * used by the mapping engine, which assigns those from the record's position.
 * See {@link quarantine} for the payload contract.
 */
export function quarantineDraft(input: QuarantineDraftInput): TrailEntryDraft {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.namespace)) {
    throw new Error(
      `quarantine: namespace must match /^[a-z0-9]+(?:-[a-z0-9]+)*$/ (got ${JSON.stringify(input.namespace)})`,
    );
  }
  const originalType =
    input.originalType ?? (typeof input.record.type === "string" ? input.record.type : undefined);
  return {
    type: "system_event",
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
