import { describe, expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
import type { ReconcilerRule } from "../types.ts";
import { reconcile } from "./index.ts";

const ctx = { agent: "codex" as const };

function entry(id: string, extra: Partial<Entry> = {}): Entry {
  return {
    type: "user_message",
    id,
    ts: "2026-05-29T00:00:00.000Z",
    payload: {},
    ...extra,
  } as Entry;
}

describe("custom reconciler passes", () => {
  test("run after built-ins and observe their output", () => {
    const seenParents: (string | null | undefined)[] = [];
    const rule: ReconcilerRule = (entries) => {
      for (const e of entries) seenParents.push(e.parent_id);
      return entries;
    };

    reconcile([entry("a"), entry("b")], { parentChain: true, custom: [rule] }, ctx);

    expect(seenParents).toEqual([null, "a"]);
  });

  test("run in array order, each receiving the prior pass's result", () => {
    const tag =
      (value: string): ReconcilerRule =>
      (entries) =>
        entries.map(
          (e) =>
            ({
              ...e,
              payload: { ...e.payload, tags: [...((e.payload.tags as string[]) ?? []), value] },
            }) as Entry,
        );

    const out = reconcile([entry("a")], { custom: [tag("first"), tag("second")] }, ctx);

    expect((out[0]?.payload as { tags: string[] }).tags).toEqual(["first", "second"]);
  });

  test("observe semantic.call_id set by the toolLinking built-in", () => {
    const seenCallIds: (string | undefined)[] = [];
    const rule: ReconcilerRule = (entries) => {
      for (const e of entries) seenCallIds.push(e.semantic?.call_id);
      return entries;
    };
    const call = {
      type: "tool_call",
      id: "call-entry",
      ts: "2026-05-29T00:00:00.000Z",
      payload: {},
      meta: { linker: { call_id: "c1" } },
    } as Entry;

    reconcile([call], { toolLinking: true, custom: [rule] }, ctx);

    expect(seenCallIds).toEqual(["c1"]);
  });
});
