import { describe, expect, test } from "bun:test";
import { defineAdapter } from "./define-adapter.ts";
import { defineMapping } from "./define-mapping.ts";
import type { RawRecord, SourcePointer, SourceReader } from "./readers/types.ts";
import type { AdapterDef } from "./types.ts";

// A reader yielding one record at cli_version 0.128.0. `valid` controls whether
// the record passes the codex/v0.128 schema (turn_context is in the type enum;
// an unknown type is drift). `version` controls schema resolution.
function codexReader(
  opts: { valid?: boolean; noVersion?: boolean; missingDriftTimestamp?: boolean } = {},
): SourceReader {
  const { valid = true, noVersion = false, missingDriftTimestamp = false } = opts;
  return {
    async *records(): AsyncIterable<RawRecord> {
      if (missingDriftTimestamp) {
        yield {
          type: "session_meta",
          timestamp: "2026-05-28T00:00:00.000Z",
          payload: { id: "s" },
        };
      }
      yield {
        type: valid ? "turn_context" : "totally-unknown-type",
        ...(missingDriftTimestamp ? {} : { timestamp: "2026-05-28T00:00:00.000Z" }),
        payload: { model: "x" },
      };
    },
    async schemaVersion(): Promise<string | undefined> {
      return noVersion ? undefined : "0.128.0";
    },
    async identityHash(): Promise<string> {
      return "hash";
    },
  };
}

function adapterDef(over: Partial<AdapterDef>): AdapterDef {
  return {
    agent: "codex-cli",
    idNamespace: "11111111-1111-1111-1111-111111111111",
    quarantineNamespace: "codex",
    sourceFormatVersions: ["v0.128"],
    reader: codexReader(),
    tsFrom: (r) => String((r as { timestamp?: string }).timestamp ?? ""),
    mappings: [],
    reconciler: {},
    ...over,
  } as AdapterDef;
}

const SOURCE: SourcePointer = { path: "unused" };

describe("AdapterDef.schemaAgent", () => {
  test("routes schema lookup to schemaAgent — valid records pass, unmapped → dropped", async () => {
    const adapter = defineAdapter(adapterDef({ schemaAgent: "codex" }));
    const entries = await adapter.parse(SOURCE, { sessionUid: "s" });
    expect(entries).toHaveLength(0);
  });

  test("schemaAgent + a record that fails the schema → quarantined", async () => {
    const adapter = defineAdapter(
      adapterDef({ schemaAgent: "codex", reader: codexReader({ valid: false }) }),
    );
    const entries = await adapter.parse(SOURCE, { sessionUid: "s" });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    expect(entry?.payload?.kind).toBe("x-codex/unknown_record");
  });

  test("timestamp-less drift inherits the nearest writer-strict source timestamp", async () => {
    const adapter = defineAdapter(
      adapterDef({
        schemaAgent: "codex",
        reader: codexReader({ valid: false, missingDriftTimestamp: true }),
      }),
    );
    const entries = await adapter.parse(SOURCE, { sessionUid: "s" });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ts).toBe("2026-05-28T00:00:00.000Z");
  });
});

describe("unrecognized source version is mapped leniently (not quarantined)", () => {
  // Matches the v1 adapters: when the version resolves to no schema, skip
  // validation and map rather than quarantining the whole session.
  test("no schemaAgent → unknown agent → no schema → record dropped, not quarantined", async () => {
    const adapter = defineAdapter(adapterDef({ reader: codexReader({ valid: false }) }));
    const entries = await adapter.parse(SOURCE, { sessionUid: "s" });
    expect(entries).toHaveLength(0);
  });

  test("schemaAgent set but source has no version → record dropped, not quarantined", async () => {
    const adapter = defineAdapter(
      adapterDef({ schemaAgent: "codex", reader: codexReader({ valid: false, noVersion: true }) }),
    );
    const entries = await adapter.parse(SOURCE, { sessionUid: "s" });
    expect(entries).toHaveLength(0);
  });

  test("no schemaKey → schema-invalid record still maps when a mapping exists", async () => {
    const adapter = defineAdapter(
      adapterDef({
        schemaAgent: "codex",
        reader: codexReader({ valid: false, noVersion: true }),
        mappings: [
          defineMapping<RawRecord>({
            match: { type: "totally-unknown-type" },
            emit: () => [
              {
                type: "system_event",
                payload: { kind: "mapped_without_schema", text: "mapped without schema" },
              },
            ],
          }),
        ],
      }),
    );

    const entries = await adapter.parse(SOURCE, { sessionUid: "s" });
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("system_event");
    expect(entry?.payload?.kind).toBe("mapped_without_schema");
  });
});
