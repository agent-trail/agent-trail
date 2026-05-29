import { describe, expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
import { reconcile } from "./index.ts";

const ctx = { agent: "codex" as const };

describe("meta.linker stripping", () => {
  test("removes meta.linker and drops meta entirely when it becomes empty", () => {
    const entry = {
      type: "tool_call",
      id: "a",
      ts: "2026-05-29T00:00:00.000Z",
      payload: {},
      meta: { linker: { call_id: "c1" } },
    } as Entry;

    const out = reconcile([entry], { toolLinking: true }, ctx);

    expect(out[0]?.meta).toBeUndefined();
  });

  test("preserves other meta keys after stripping linker", () => {
    const entry = {
      type: "agent_message",
      id: "a",
      ts: "2026-05-29T00:00:00.000Z",
      payload: {},
      meta: { linker: { call_id: "c1" }, "x-codex/raw_type": "message" },
    } as Entry;

    const out = reconcile([entry], {}, ctx);

    expect(out[0]?.meta).toEqual({ "x-codex/raw_type": "message" });
  });
});
