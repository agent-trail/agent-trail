import { describe, expect, test } from "bun:test";
import { defineAdapter } from "./define-adapter.ts";
import type { RawRecord, SourcePointer, SourceReader } from "./readers/types.ts";
import type { AdapterDef } from "./types.ts";

// A reader yielding one valid Codex record (turn_context is in the codex/v0.128
// type enum) at cli_version 0.128.0.
function codexReader(): SourceReader {
  return {
    async *records(): AsyncIterable<RawRecord> {
      yield {
        type: "turn_context",
        timestamp: "2026-05-28T00:00:00.000Z",
        payload: { model: "x" },
      };
    },
    async schemaVersion(): Promise<string> {
      return "0.128.0";
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
  test("routes schema lookup to schemaAgent, leaving valid records un-quarantined", async () => {
    const adapter = defineAdapter(adapterDef({ schemaAgent: "codex" }));
    const entries = await adapter.parse(SOURCE, { sessionUid: "s" });
    // Valid record + no matching mapping → dropped, not quarantined.
    expect(entries).toHaveLength(0);
  });

  test("without schemaAgent, the emitted agent ('codex-cli') has no schema → everything quarantines", async () => {
    const adapter = defineAdapter(adapterDef({}));
    const entries = await adapter.parse(SOURCE, { sessionUid: "s" });
    expect(entries).toHaveLength(1);
    expect((entries[0]?.payload as { kind?: string }).kind).toBe("x-codex/unknown_record");
  });
});
