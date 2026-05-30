import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { parsePiV2Entries } from "./index.ts";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/pi");

const entries = (fixture: string): Promise<Entry[]> =>
  parsePiV2Entries(join(FIXTURES, fixture), "unit-test");

// branch_summary and session_terminated carry id-reference payloads the diff
// harness can't compare structurally, so assert their non-id content directly.
describe("pi v2 suppressed-entry content", () => {
  test("branch_summary: summary + meta preserved, abandoned_branch_id resolves to a real entry", async () => {
    const all = await entries("branch-flow.jsonl");
    const summary = all.find((e) => e.type === "branch_summary");
    expect(summary).toBeDefined();
    expect(summary?.payload.summary).toBe("Explored X, switching to Y.");
    expect((summary?.meta as Record<string, unknown>)["dev.pi.raw_type"]).toBe(
      "branch_summary_envelope",
    );
    const abandoned = summary?.payload.abandoned_branch_id;
    expect(typeof abandoned).toBe("string");
    // resolves to an actual emitted entry id (the abandoned branch root)
    expect(all.some((e) => e.id === abandoned)).toBe(true);
    // the parenting hint must be stripped from final output
    expect((summary?.meta as Record<string, unknown>)["x-pi/_h"]).toBeUndefined();
  });

  test("session_terminated: reason + open_call_ids reference real tool_call entries", async () => {
    const all = await entries("reasoning-and-interrupt.jsonl");
    const terminated = all.find((e) => e.type === "session_terminated");
    expect(terminated).toBeDefined();
    expect(terminated?.payload.reason).toBe("eof_with_open_tool_calls");
    const openIds = terminated?.payload.open_call_ids as string[];
    expect(openIds.length).toBeGreaterThan(0);
    const toolCallIds = new Set(all.filter((e) => e.type === "tool_call").map((e) => e.id));
    expect(openIds.every((id) => toolCallIds.has(id))).toBe(true);
  });
});
