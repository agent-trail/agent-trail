import { describe, expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
import { reconcile } from "./index.ts";

const ctx = { agent: "pi" as const };
const entry = {
  type: "user_message",
  id: "a",
  ts: "2026-05-29T00:00:00.000Z",
  payload: {},
} as Entry;

describe("branchReconciliation stub", () => {
  test("throws a clear not-implemented error when enabled", () => {
    expect(() => reconcile([entry], { branchReconciliation: true }, ctx)).toThrow(
      "branchReconciliation not yet implemented (Phase 4, #135). Disable it or use a linear session structure for now.",
    );
  });

  test("is a silent no-op when absent or false", () => {
    expect(reconcile([entry], {}, ctx)).toHaveLength(1);
    expect(reconcile([entry], { branchReconciliation: false }, ctx)).toHaveLength(1);
  });
});
