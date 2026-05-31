import { describe, expect, test } from "bun:test";
import { defineAdapter } from "./define-adapter.ts";
import type { RawRecord, SourcePointer, SourceReader } from "./readers/types.ts";
import type { AdapterDef } from "./types.ts";

// A reader yielding one record at cli_version 0.128.0. `valid` controls whether
// the record passes the codex/v0.128 schema (turn_context is in the type enum;
// an unknown type is drift). `version` controls schema resolution.
function codexReader(opts: { valid?: boolean; noVersion?: boolean } = {}): SourceReader {
  const { valid = true, noVersion = false } = opts;
  return {
    async *records(): AsyncIterable<RawRecord> {
      yield {
        type: valid ? "turn_context" : "totally-unknown-type",
        timestamp: "2026-05-28T00:00:00.000Z",
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
    expect((entries[0]?.payload as { kind?: string }).kind).toBe("x-codex/unknown_record");
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
});
