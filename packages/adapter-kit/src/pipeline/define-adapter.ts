import type { Entry } from "@agent-trail/types";
import type { RawRecord, SourcePointer, SourceSnapshot } from "../readers/types.ts";
import { reconcile } from "../reconciler/index.ts";
import { selectSchemaVersion } from "../source-schemas/select.ts";
import { validateSourceRecord } from "../source-schemas/validate.ts";
import type { AdapterDef, ParseOptions } from "../types.ts";
import { runPass1 } from "./engine.ts";
import { quarantineDraft } from "./quarantine.ts";

export interface Adapter {
  /**
   * Read a source, map its records to trail entries, and reconcile them. Records
   * that fail a resolved source-schema validation become lossless quarantine
   * `system_event`s; when no source schema resolves, validation is unavailable
   * and mappings run leniently. Returns entries only — discovery and header
   * building are per-adapter glue (#135 P4).
   */
  parse(source: SourcePointer, options: ParseOptions): Promise<Entry[]>;
  /**
   * Map and reconcile already-read source records. Snapshot records must already
   * match the reader-equivalent shape expected by mappings and reconciler rules.
   * When `sourceVersion` is omitted, source-schema drift validation is skipped,
   * matching parse() behavior for sources with unknown versions.
   */
  parseSnapshot(snapshot: SourceSnapshot, options: ParseOptions): Promise<Entry[]>;
}

function parseSnapshotRecords<S>(
  def: AdapterDef<S>,
  snapshot: SourceSnapshot,
  options: ParseOptions,
): Entry[] {
  const schemaAgent = def.schemaAgent ?? def.agent;
  const schemaKey = selectSchemaVersion(schemaAgent, snapshot.sourceVersion);

  const entries = runPass1<S>(snapshot.records, {
    mappings: def.mappings,
    overrides: def.overrides,
    initialState: def.initialState,
    idNamespace: def.idNamespace,
    sessionUid: options.sessionUid,
    tsFrom: def.tsFrom,
    drift: {
      // Quarantine only when we have a schema AND the record fails it. When
      // the source version is unrecognized (no schemaKey), map leniently —
      // matching the v1 adapters, which skip validation for unknown versions
      // rather than quarantining the whole session.
      isDrift: (record) =>
        schemaKey !== undefined && validateSourceRecord(schemaAgent, schemaKey, record).length > 0,
      toDraft: (record) =>
        quarantineDraft({ agent: def.agent, namespace: def.quarantineNamespace, record }),
    },
  });

  return reconcile(entries, def.reconciler, { agent: def.agent, records: snapshot.records });
}

/**
 * Assemble a mapping-based adapter: a `SourceReader`, typed mappings/overrides,
 * and an opt-in reconciler config. The returned `parse` runs the two-pass model
 * (pure mappings → reconciler) over the reader's records.
 */
export function defineAdapter<S = unknown>(def: AdapterDef<S>): Adapter {
  return {
    async parse(source, options) {
      const sourceVersion = await def.reader.schemaVersion(source);

      const records: RawRecord[] = [];
      for await (const record of def.reader.records(source)) {
        records.push(record);
      }

      return parseSnapshotRecords(def, { records, sourceVersion }, options);
    },
    async parseSnapshot(snapshot, options) {
      return parseSnapshotRecords(def, snapshot, options);
    },
  };
}
