import type { Entry } from "@agent-trail/types";
import { runPass1 } from "./engine.ts";
import { quarantineDraft } from "./quarantine.ts";
import type { RawRecord, SourcePointer } from "./readers/types.ts";
import { reconcile } from "./reconciler/index.ts";
import { selectSchemaVersion } from "./source-schemas/select.ts";
import { validateSourceRecord } from "./source-schemas/validate.ts";
import type { AdapterDef, ParseOptions } from "./types.ts";

export interface Adapter {
  /**
   * Read a source, map its records to trail entries, and reconcile them. Records
   * that fail source-schema validation (unknown version or shape drift) become
   * lossless quarantine `system_event`s. Returns entries only — discovery and
   * header building are per-adapter glue (#135 P4).
   */
  parse(source: SourcePointer, options: ParseOptions): Promise<Entry[]>;
}

/**
 * Assemble a mapping-based adapter: a `SourceReader`, typed mappings/overrides,
 * and an opt-in reconciler config. The returned `parse` runs the two-pass model
 * (pure mappings → reconciler) over the reader's records.
 */
export function defineAdapter<S = unknown>(def: AdapterDef<S>): Adapter {
  return {
    async parse(source, options) {
      const schemaAgent = def.schemaAgent ?? def.agent;
      const sourceVersion = await def.reader.schemaVersion(source);
      const schemaKey = selectSchemaVersion(schemaAgent, sourceVersion);

      const records: RawRecord[] = [];
      for await (const record of def.reader.records(source)) {
        records.push(record);
      }

      const entries = runPass1<S>(records, {
        mappings: def.mappings,
        overrides: def.overrides,
        initialState: def.initialState,
        idNamespace: def.idNamespace,
        sessionUid: options.sessionUid,
        tsFrom: def.tsFrom,
        drift: {
          isDrift: (record) =>
            schemaKey === undefined ||
            validateSourceRecord(schemaAgent, schemaKey, record).length > 0,
          toDraft: (record) =>
            quarantineDraft({ agent: def.agent, namespace: def.quarantineNamespace, record }),
        },
      });

      return reconcile(entries, def.reconciler, { agent: def.agent });
    },
  };
}
