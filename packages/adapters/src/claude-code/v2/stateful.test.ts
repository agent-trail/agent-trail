import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { parseClaudeCodeV2Entries } from "./index.ts";

const FIXTURES = join(import.meta.dir, "../../../tests/fixtures/claude-code");
const entries = (fixture: string): Promise<Entry[]> =>
  parseClaudeCodeV2Entries(join(FIXTURES, fixture), "unit-test");

describe("claude-code v2 stateful behaviors", () => {
  test("model_change synth: from/to + synthesized across a model switch", async () => {
    const all = await entries("interrupt-and-model-change.jsonl");
    const change = all.find((e) => e.type === "model_change");
    expect(change).toBeDefined();
    expect(change?.payload.from_model).toBe("claude-opus-4-7");
    expect(change?.payload.to_model).toBe("claude-sonnet-4-5");
    expect(change?.source?.synthesized).toBe(true);
    // hint stripped → no entry-level meta on the final entry
    expect(change?.meta).toBeUndefined();
  });

  test("permission_mode delta: from/to + delta text on the second change", async () => {
    const all = await entries("permission-mode.jsonl");
    const pms = all.filter(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "permission_mode_change",
    );
    expect(pms).toHaveLength(2);
    expect((pms[0]?.payload as { data?: { to?: string; from?: string } }).data).toEqual({
      to: "default",
    });
    expect(pms[0]?.payload.text).toBe("Permission mode: default");
    expect((pms[1]?.payload as { data?: { to?: string; from?: string } }).data).toEqual({
      to: "acceptEdits",
      from: "default",
    });
    expect(pms[1]?.payload.text).toBe("Permission mode changed: default → acceptEdits");
  });

  test("multi-block fanout: envelope_ref backfilled to the first block's entry id", async () => {
    const all = await entries("fidelity-edge-cases.jsonl");
    // find a multi-block entry carrying an envelope_ref (non-first block)
    const withRef = all.find((e) => {
      const raw = (e.source as { raw?: Record<string, unknown> })?.raw;
      return raw !== undefined && "envelope_ref" in raw;
    });
    expect(withRef).toBeDefined();
    const ref = ((withRef?.source as { raw?: { envelope_ref?: string } }).raw ?? {}).envelope_ref;
    expect(typeof ref).toBe("string");
    expect(ref).not.toBe(""); // backfilled to a real id, not the placeholder
    expect(all.some((e) => e.id === ref)).toBe(true);
  });
});
