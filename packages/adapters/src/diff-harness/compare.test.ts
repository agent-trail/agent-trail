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

  test("differing branch_summary.abandoned_branch_id only → preserved (id rehash tolerance)", () => {
    const oldEntries = [
      {
        type: "branch_summary",
        id: "old-1",
        ts: "2026-05-21T14:00:00.000Z",
        payload: { summary: "switched", abandoned_branch_id: "old-root" },
      } as Entry,
    ];
    const newEntries = [
      {
        type: "branch_summary",
        id: "new-1",
        ts: "2026-05-21T14:00:00.000Z",
        payload: { summary: "switched", abandoned_branch_id: "new-root" },
      } as Entry,
    ];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.preserved).toHaveLength(1);
    expect(report.regressions).toHaveLength(0);
  });

  test("differing session_terminated.open_call_ids only → preserved; summary change → regression", () => {
    const make = (ids: string[], reason: string): Entry =>
      ({
        type: "session_terminated",
        id: ids[0],
        ts: "2026-05-21T14:00:00.000Z",
        payload: { reason, open_call_ids: ids },
      }) as Entry;

    const preserved = compareEntries([make(["a"], "eof")], [make(["b"], "eof")]);
    expect(preserved.regressions).toHaveLength(0);

    // non-id payload (reason) still compared
    const regressed = compareEntries([make(["a"], "eof")], [make(["b"], "other")]);
    expect(regressed.regressions).toHaveLength(1);
  });

  test("differing source.raw.envelope_ref only → preserved (id rehash tolerance)", () => {
    const oldEntries = [
      agentMessage("old-1", "hi", {
        source: { agent: "pi", raw: { envelope_ref: "old-first", block_index: 1 } },
      } as Partial<Entry>),
    ];
    const newEntries = [
      agentMessage("new-1", "hi", {
        source: { agent: "pi", raw: { envelope_ref: "new-first", block_index: 1 } },
      } as Partial<Entry>),
    ];

    const report = compareEntries(oldEntries, newEntries);

    expect(report.preserved).toHaveLength(1);
    expect(report.regressions).toHaveLength(0);
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
