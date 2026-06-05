import { expect, test } from "bun:test";
import { defineMapping } from "./define-mapping.ts";

// Compile-time guard for PR #151: a union-typed property must distribute so the
// object arm accepts a partial nested pattern (rather than collapsing to the
// whole union). This file failing to typecheck is the real assertion.
interface UnionPropRecord extends Record<string, unknown> {
  type: "evt";
  payload: string | { kind: "a" | "b"; extra: number };
}

test("MatchPattern distributes over union-typed properties", () => {
  const m = defineMapping<UnionPropRecord>({
    // partial pattern against the object arm of `payload` — only legal if the
    // union distributed; `extra` is intentionally omitted.
    match: { type: "evt", payload: { kind: "a" } },
    emit: () => [{ type: "system_event" as const }],
  });

  expect(m.match.type).toBe("evt");
});
