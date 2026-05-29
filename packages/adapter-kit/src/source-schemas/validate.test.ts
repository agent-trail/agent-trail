import { describe, expect, test } from "bun:test";
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
});
