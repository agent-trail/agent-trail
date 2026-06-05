import type { Entry } from "@agent-trail/types";
import { dispatch } from "../mapping/dispatch.ts";
import { deriveSynthesizedEntryId } from "../mapping/ids.ts";
import { matchesPattern } from "../mapping/match.ts";
import type { RawRecord } from "../readers/types.ts";
import type { MappingDef, OverrideDef, TrailEntryDraft } from "../types.ts";

const WRITER_STRICT_ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function usableTimestamp(ts: string): string | undefined {
  return WRITER_STRICT_ISO8601.test(ts) ? ts : undefined;
}

export interface Pass1Params<S = unknown> {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous mapping inputs
  mappings: MappingDef<any>[];
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous override inputs
  overrides?: OverrideDef<any, S>[];
  initialState?: () => S;
  idNamespace: string;
  sessionUid: string;
  tsFrom: (record: RawRecord) => string;
  /** Reroute records that fail source-schema validation to a quarantine draft. */
  drift?: {
    isDrift: (record: RawRecord) => boolean;
    toDraft: (record: RawRecord) => TrailEntryDraft;
  };
}

/**
 * Pass 1: walk source records and materialize emitted drafts into entries. Each
 * record routes to an override first (escape hatch), else to a pure mapping;
 * unmatched records are dropped. The engine assigns `id` (deterministic v5 UUID
 * from `[sessionUid, recordIndex, type, ordinal]`) and `ts` (via `tsFrom`),
 * leaving `meta.linker` hints for the reconciler. `parent_id` is filled later by
 * the reconciler unless a draft set it.
 */
export function runPass1<S = unknown>(records: RawRecord[], params: Pass1Params<S>): Entry[] {
  if (params.overrides?.length && params.initialState === undefined) {
    throw new Error("runPass1: overrides require initialState");
  }
  const entries: Entry[] = [];
  const state = params.initialState?.() as S;
  const firstUsableTs = records
    .map((record) => usableTimestamp(params.tsFrom(record)))
    .find((ts) => ts !== undefined);
  let inheritedTs = firstUsableTs;

  records.forEach((record, index) => {
    const recordTs = params.tsFrom(record);
    const usableRecordTs = usableTimestamp(recordTs);
    if (usableRecordTs !== undefined) inheritedTs = usableRecordTs;

    if (params.drift?.isDrift(record) === true) {
      appendDrafts(
        entries,
        [params.drift.toDraft(record)],
        record,
        index,
        params,
        usableRecordTs ?? inheritedTs ?? "",
      );
      return;
    }

    const override = params.overrides?.find((o) => matchesPattern(record, o.match));
    if (override !== undefined) {
      // ctx.emit() fanout is unbounded by design; each emitted draft gets a
      // deterministic id by ordinal within this record (see appendDrafts).
      const synthetic: TrailEntryDraft[] = [];
      const ctx = {
        window: { recent: (n: number) => records.slice(Math.max(0, index - n), index) },
        state,
        emit: (draft: TrailEntryDraft) => synthetic.push(draft),
      };
      const drafts = override.emit(record, ctx);
      appendDrafts(entries, [...drafts, ...synthetic], record, index, params);
      return;
    }

    const mapping = dispatch(record, params.mappings);
    if (mapping === undefined) return;
    appendDrafts(entries, mapping.emit(record), record, index, params);
  });

  return entries;
}

export function appendDrafts(
  entries: Entry[],
  drafts: TrailEntryDraft[],
  record: RawRecord,
  index: number,
  params: Pick<Pass1Params, "idNamespace" | "sessionUid" | "tsFrom">,
  tsOverride?: string,
): void {
  const ts = tsOverride ?? params.tsFrom(record);
  drafts.forEach((draft, ordinal) => {
    const id = deriveSynthesizedEntryId(params.idNamespace, [
      params.sessionUid,
      String(index),
      draft.type,
      String(ordinal),
    ]);
    entries.push(draftToEntry(draft, id, ts));
  });
}

function draftToEntry(draft: TrailEntryDraft, id: string, ts: string): Entry {
  return {
    type: draft.type,
    id,
    ts,
    payload: draft.payload ?? {},
    ...(draft.parent_id !== undefined ? { parent_id: draft.parent_id } : {}),
    ...(draft.semantic !== undefined ? { semantic: draft.semantic } : {}),
    ...(draft.source !== undefined ? { source: draft.source } : {}),
    ...(draft.meta !== undefined ? { meta: draft.meta } : {}),
  } as Entry;
}
