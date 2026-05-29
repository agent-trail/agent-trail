import { describe, expect, test } from "bun:test";
import { defineMapping } from "./define-mapping.ts";
import { runPass1 } from "./engine.ts";
import type { RawRecord } from "./readers/types.ts";

const NS = "e8f4b9a5-af67-4bcd-d156-738f9a0b1c23";

const params = {
  idNamespace: NS,
  sessionUid: "session-1",
  tsFrom: (r: RawRecord) => String(r.ts),
};

describe("runPass1", () => {
  test("assigns ts from tsFrom and a deterministic, re-parse-stable id", () => {
    const mapping = defineMapping({
      match: { type: "user_message" },
      emit: (r: RawRecord) => [
        { type: "user_message" as const, payload: { text: String(r.text) } },
      ],
    });
    const records: RawRecord[] = [
      { type: "user_message", text: "hi", ts: "2026-05-29T00:00:00.000Z" },
    ];

    const first = runPass1(records, { ...params, mappings: [mapping] });
    const second = runPass1(records, { ...params, mappings: [mapping] });

    expect(first).toHaveLength(1);
    expect(first[0]?.ts).toBe("2026-05-29T00:00:00.000Z");
    expect(first[0]?.payload).toEqual({ text: "hi" });
    expect(first[0]?.id).toBe(second[0]?.id ?? "");
  });

  test("gives fanned-out drafts from one record distinct ids", () => {
    const mapping = defineMapping({
      match: { type: "multi" },
      emit: () => [
        { type: "agent_message" as const, payload: { text: "a" } },
        { type: "tool_call" as const, payload: {} },
      ],
    });
    const records: RawRecord[] = [{ type: "multi", ts: "2026-05-29T00:00:00.000Z" }];

    const entries = runPass1(records, { ...params, mappings: [mapping] });

    expect(entries).toHaveLength(2);
    expect(entries[0]?.id).not.toBe(entries[1]?.id);
  });

  test("drops records with no matching mapping", () => {
    const mapping = defineMapping({
      match: { type: "user_message" },
      emit: () => [{ type: "user_message" as const }],
    });
    const records: RawRecord[] = [{ type: "nope", ts: "2026-05-29T00:00:00.000Z" }];

    expect(runPass1(records, { ...params, mappings: [mapping] })).toHaveLength(0);
  });

  test("returns an empty array for empty input", () => {
    expect(runPass1([], { ...params, mappings: [] })).toEqual([]);
  });

  test("throws when overrides are given without initialState", () => {
    const override = {
      match: { type: "user_message" },
      emit: () => [{ type: "user_message" as const }],
    };
    const records: RawRecord[] = [{ type: "user_message", ts: "2026-05-29T00:00:00.000Z" }];

    expect(() => runPass1(records, { ...params, mappings: [], overrides: [override] })).toThrow(
      /overrides require initialState/,
    );
  });

  test("handles an override that emits zero drafts", () => {
    const override = {
      match: { type: "user_message" },
      emit: () => [],
    };
    const records: RawRecord[] = [{ type: "user_message", ts: "2026-05-29T00:00:00.000Z" }];

    const entries = runPass1(records, {
      ...params,
      mappings: [],
      overrides: [override],
      initialState: () => ({}),
    });
    expect(entries).toHaveLength(0);
  });
});
