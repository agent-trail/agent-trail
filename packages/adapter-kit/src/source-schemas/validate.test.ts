import { describe, expect, test } from "bun:test";
import type { RawRecord } from "../readers/types.ts";
import { validateSourceRecord } from "./validate.ts";

describe("validateSourceRecord", () => {
  test("valid codex record returns no diagnostics", () => {
    const record = {
      timestamp: "2026-05-28T11:00:00.000Z",
      type: "session_meta",
      payload: { id: "abc", cli_version: "0.128.0", originator: "codex-tui" },
    };
    expect(validateSourceRecord("codex", "v0.128", record)).toEqual([]);
  });

  test("unknown top-level type is rejected", () => {
    const record = { type: "totally_new_record", payload: {} };
    const diagnostics = validateSourceRecord("codex", "v0.128", record);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.severity).toBe("error");
  });

  test("unknown event_msg subtype is rejected (record-type drift)", () => {
    const record = { type: "event_msg", payload: { type: "brand_new_event" } };
    expect(validateSourceRecord("codex", "v0.128", record).length).toBeGreaterThan(0);
  });

  test("unknown agent/version returns one diagnostic instead of throwing", () => {
    const diagnostics = validateSourceRecord("codex", "v9.99", { type: "session_meta" });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("unknown-source-schema");
  });

  test("null input is rejected with type-mismatch diagnostic", () => {
    const diagnostics = validateSourceRecord("codex", "v0.128", null as unknown as RawRecord);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.severity).toBe("error");
    }
    expect(diagnostics.some((d) => d.code === "source-type-mismatch")).toBe(true);
  });

  test("non-object input is rejected", () => {
    const stringDiags = validateSourceRecord("codex", "v0.128", "nope" as unknown as RawRecord);
    expect(stringDiags.length).toBeGreaterThan(0);
    const numberDiags = validateSourceRecord("codex", "v0.128", 42 as unknown as RawRecord);
    expect(numberDiags.length).toBeGreaterThan(0);
  });

  test("missing required `type` yields source-missing-required-field", () => {
    const diagnostics = validateSourceRecord("codex", "v0.128", {} as unknown as RawRecord);
    expect(diagnostics.some((d) => d.code === "source-missing-required-field")).toBe(true);
  });

  test("non-string `type` yields enum or type mismatch", () => {
    const diagnostics = validateSourceRecord("codex", "v0.128", {
      type: 999,
    } as unknown as RawRecord);
    const codes = diagnostics.map((d) => d.code);
    expect(codes.includes("source-enum-mismatch") || codes.includes("source-type-mismatch")).toBe(
      true,
    );
  });
});
