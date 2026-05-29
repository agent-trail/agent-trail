import { describe, expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
import { reconcile } from "./index.ts";

const ctx = { agent: "codex" as const };

function entry(type: string, id: string, callId?: string, extra: Partial<Entry> = {}): Entry {
  return {
    type,
    id,
    ts: "2026-05-29T00:00:00.000Z",
    payload: {},
    ...(callId !== undefined ? { meta: { linker: { call_id: callId } } } : {}),
    ...extra,
  } as Entry;
}

describe("toolLinking reconciler rule", () => {
  test("sets for_id + semantic.call_id on the result that shares a linker call_id", () => {
    const out = reconcile(
      [entry("tool_call", "call-entry", "c1"), entry("tool_result", "result-entry", "c1")],
      { toolLinking: true },
      ctx,
    );

    expect(out[0]?.semantic?.call_id).toBe("c1");
    expect((out[1]?.payload as { for_id?: string }).for_id).toBe("call-entry");
    expect(out[1]?.semantic?.call_id).toBe("c1");
  });

  test("leaves an unmatched tool_result without a for_id", () => {
    const out = reconcile(
      [entry("tool_result", "result-entry", "orphan")],
      { toolLinking: true },
      ctx,
    );

    expect((out[0]?.payload as { for_id?: string }).for_id).toBeUndefined();
    expect(out[0]?.semantic?.call_id).toBe("orphan");
  });

  test("no-op when toolLinking disabled", () => {
    const out = reconcile([entry("tool_result", "result-entry", "c1")], {}, ctx);
    expect((out[0]?.payload as { for_id?: string }).for_id).toBeUndefined();
  });

  test("is a clean no-op for entries with no linker hint", () => {
    const out = reconcile([entry("tool_result", "result-entry")], { toolLinking: true }, ctx);
    expect((out[0]?.payload as { for_id?: string }).for_id).toBeUndefined();
    expect(out[0]?.semantic?.call_id).toBeUndefined();
  });

  test("throws when meta.linker is not an object", () => {
    const bad = entry("tool_call", "x", undefined, { meta: { linker: 123 } } as Partial<Entry>);
    expect(() => reconcile([bad], { toolLinking: true }, ctx)).toThrow(
      /meta\.linker must be an object/,
    );
  });

  test("throws when meta.linker.call_id is not a string", () => {
    const bad = entry("tool_call", "x", undefined, {
      meta: { linker: { call_id: 123 } },
    } as Partial<Entry>);
    expect(() => reconcile([bad], { toolLinking: true }, ctx)).toThrow(
      /meta\.linker\.call_id must be a string/,
    );
  });
});
