import { describe, expect, test } from "bun:test";
import { defineMapping } from "./define-mapping.ts";
import { runPass1 } from "./engine.ts";
import type { RawRecord } from "./readers/types.ts";
import type { OverrideDef } from "./types.ts";

const NS = "e8f4b9a5-af67-4bcd-d156-738f9a0b1c23";
const base = { idNamespace: NS, sessionUid: "s1", tsFrom: (r: RawRecord) => String(r.ts) };

describe("override escape hatch", () => {
  test("routes matching records to the override with window back-look and mutable state", () => {
    const seenWindowLengths: number[] = [];
    const override: OverrideDef<RawRecord, { count: number }> = {
      match: { type: "tick" },
      emit: (_record, ctx) => {
        ctx.state.count += 1;
        seenWindowLengths.push(ctx.window.recent(10).length);
        return [{ type: "system_event" as const, payload: { count: ctx.state.count } }];
      },
    };
    const records: RawRecord[] = [
      { type: "tick", ts: "2026-05-29T00:00:00.000Z" },
      { type: "tick", ts: "2026-05-29T00:00:01.000Z" },
    ];

    const out = runPass1(records, {
      mappings: [],
      overrides: [override],
      initialState: () => ({ count: 0 }),
      ...base,
    });

    expect(out.map((e) => (e.payload as { count: number }).count)).toEqual([1, 2]);
    expect(seenWindowLengths).toEqual([0, 1]);
  });

  test("ctx.emit appends synthetic drafts alongside the returned drafts", () => {
    const override: OverrideDef<RawRecord, unknown> = {
      match: { type: "x" },
      emit: (_record, ctx) => {
        ctx.emit({ type: "system_event" as const, payload: { synthetic: true } });
        return [{ type: "agent_message" as const, payload: { text: "real" } }];
      },
    };

    const out = runPass1([{ type: "x", ts: "2026-05-29T00:00:00.000Z" }], {
      mappings: [],
      overrides: [override],
      initialState: () => ({}),
      ...base,
    });

    expect(out).toHaveLength(2);
    expect(out[0]?.type).toBe("agent_message");
    expect(out[1]?.type).toBe("system_event");
    expect(out[0]?.id).not.toBe(out[1]?.id);
  });

  test("overrides take precedence over a pure mapping matching the same record", () => {
    const mapping = defineMapping({
      match: { type: "x" },
      emit: () => [{ type: "user_message" as const }],
    });
    const override: OverrideDef<RawRecord, unknown> = {
      match: { type: "x" },
      emit: () => [{ type: "agent_message" as const }],
    };

    const out = runPass1([{ type: "x", ts: "2026-05-29T00:00:00.000Z" }], {
      mappings: [mapping],
      overrides: [override],
      initialState: () => ({}),
      ...base,
    });

    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("agent_message");
  });
});
