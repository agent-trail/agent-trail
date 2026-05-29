import { describe, expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
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

describe("parentChain reconciler rule", () => {
  test("links each entry to the previous emitted entry; root has null parent", () => {
    const out = reconcile([entry("a"), entry("b"), entry("c")], { parentChain: true }, ctx);

    expect(out[0]?.parent_id).toBeNull();
    expect(out[1]?.parent_id).toBe("a");
    expect(out[2]?.parent_id).toBe("b");
  });

  test("preserves an explicit parent_id set by the mapping", () => {
    const out = reconcile(
      [entry("a"), entry("b", { parent_id: "a" }), entry("c")],
      { parentChain: true },
      ctx,
    );

    expect(out[1]?.parent_id).toBe("a");
    expect(out[2]?.parent_id).toBe("b");
  });

  test("preserves an explicit parent_id of null (does not chain to previous)", () => {
    const out = reconcile(
      [entry("a"), entry("b", { parent_id: null }), entry("c")],
      { parentChain: true },
      ctx,
    );

    expect(out[1]?.parent_id).toBeNull();
    expect(out[2]?.parent_id).toBe("b");
  });

  test("no-op when parentChain disabled", () => {
    const out = reconcile([entry("a"), entry("b")], {}, ctx);
    expect(out[0]?.parent_id).toBeUndefined();
    expect(out[1]?.parent_id).toBeUndefined();
  });
});
