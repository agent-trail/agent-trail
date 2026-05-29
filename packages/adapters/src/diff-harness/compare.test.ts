import { describe, expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
import { compareEntries } from "./compare.ts";

function agentMessage(id: string, text: string, extra?: Partial<Entry>): Entry {
  return {
    type: "agent_message",
    id,
    ts: "2026-05-21T14:00:00.000Z",
    payload: { text },
    ...extra,
  } as Entry;
}

describe("compareEntries", () => {
  test("old and new identical except id → all preserved, not blocking", () => {
    const oldEntries = [agentMessage("old-1", "hello")];
    const newEntries = [agentMessage("new-1", "hello")];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.preserved).toHaveLength(1);
    expect(report.regressions).toHaveLength(0);
    expect(report.additions).toHaveLength(0);
    expect(report.blocking).toBe(false);
  });

  test("new output drops an old entry → regression, blocking", () => {
    const oldEntries = [agentMessage("old-1", "hello"), agentMessage("old-2", "world")];
    const newEntries = [agentMessage("new-1", "hello")];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.preserved).toHaveLength(1);
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0]?.payload.text).toBe("world");
    expect(report.blocking).toBe(true);
  });

  test("new output adds an entry → addition, non-blocking", () => {
    const oldEntries = [agentMessage("old-1", "hello")];
    const newEntries = [agentMessage("new-1", "hello"), agentMessage("new-2", "extra")];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.preserved).toHaveLength(1);
    expect(report.additions).toHaveLength(1);
    expect(report.additions[0]?.payload.text).toBe("extra");
    expect(report.regressions).toHaveLength(0);
    expect(report.blocking).toBe(false);
  });

  test("differing id/parent_id/for_id/call_id only → preserved (id rehash tolerance)", () => {
    const oldEntries = [
      agentMessage("old-1", "hi", {
        parent_id: "old-parent",
        semantic: { call_id: "old-call", group_id: "old-group" },
        payload: { text: "hi", for_id: "old-call" },
      }),
    ];
    const newEntries = [
      agentMessage("new-1", "hi", {
        parent_id: "new-parent",
        semantic: { call_id: "new-call", group_id: "new-group" },
        payload: { text: "hi", for_id: "new-call" },
      }),
    ];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.preserved).toHaveLength(1);
    expect(report.regressions).toHaveLength(0);
  });

  test("whitespace-only payload difference → preserved", () => {
    const oldEntries = [agentMessage("old-1", "hello   world")];
    const newEntries = [agentMessage("new-1", "hello world\n")];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.preserved).toHaveLength(1);
    expect(report.regressions).toHaveLength(0);
  });

  test("meaningful payload change → regression", () => {
    const oldEntries = [agentMessage("old-1", "hello world")];
    const newEntries = [agentMessage("new-1", "goodbye world")];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.regressions).toHaveLength(1);
    expect(report.additions).toHaveLength(1);
    expect(report.blocking).toBe(true);
  });

  test("expectedDivergences predicate suppresses a known-quirk old entry", () => {
    const oldEntries = [agentMessage("old-1", "output\n· ")];
    const newEntries = [agentMessage("new-1", "output")];

    const report = compareEntries(oldEntries, newEntries, {
      expectedDivergences: (entry) => String(entry.payload.text ?? "").includes("·"),
    });

    expect(report.regressions).toHaveLength(0);
    expect(report.expectedDivergences).toHaveLength(1);
    expect(report.blocking).toBe(false);
  });

  test("multiset: two identical old, one in new → one preserved, one regression", () => {
    const oldEntries = [agentMessage("old-1", "dup"), agentMessage("old-2", "dup")];
    const newEntries = [agentMessage("new-1", "dup")];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.preserved).toHaveLength(1);
    expect(report.regressions).toHaveLength(1);
    expect(report.blocking).toBe(true);
  });
});
