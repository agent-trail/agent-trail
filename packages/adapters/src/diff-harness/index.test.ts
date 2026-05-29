import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import type { SessionRef, TrailAdapter, TrailFile } from "../index.ts";
import { runDiffHarness, type V2HarnessTarget, v2HarnessTargets } from "./index.ts";

function entry(id: string, text: string): Entry {
  return {
    type: "agent_message",
    id,
    ts: "2026-05-21T14:00:00.000Z",
    payload: { text },
  } as Entry;
}

/** Old adapter stub: returns a fixed entry list regardless of the ref. */
function stubOld(entries: Entry[]): TrailAdapter {
  return {
    name: "stub",
    detectSessions: async () => [],
    parseSession: async (_ref: SessionRef): Promise<TrailFile> =>
      ({ header: { id: "h" }, entries }) as unknown as TrailFile,
    isAvailable: async () => true,
    sourceVersion: async () => null,
  };
}

describe("runDiffHarness", () => {
  test("empty registry → no reports, not blocking", async () => {
    const summary = await runDiffHarness([]);

    expect(summary.targets).toBe(0);
    expect(summary.reports).toHaveLength(0);
    expect(summary.blocking).toBe(false);
  });

  test("ships with an empty v2 registry until the first migration lands", () => {
    expect(v2HarnessTargets).toHaveLength(0);
  });
});

describe("runDiffHarness end-to-end", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "diff-harness-"));
    writeFileSync(join(dir, "a.jsonl"), "{}\n");
    writeFileSync(join(dir, "b.jsonl"), "{}\n");
    writeFileSync(join(dir, "ignore.txt"), "not a fixture\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function target(over: Partial<V2HarnessTarget>): V2HarnessTarget {
    return {
      agent: "stub",
      fixturesDir: dir,
      old: stubOld([entry("old-1", "hello")]),
      parseNew: async () => [entry("new-1", "hello")],
      ...over,
    };
  }

  test("new output matches old over every .jsonl fixture → all preserved, not blocking", async () => {
    const summary = await runDiffHarness([target({})]);

    expect(summary.reports).toHaveLength(2); // a.jsonl + b.jsonl, ignore.txt skipped
    expect(summary.blocking).toBe(false);
    for (const r of summary.reports) {
      expect(r.report?.preserved).toHaveLength(1);
      expect(r.report?.regressions).toHaveLength(0);
    }
  });

  test("new output drops an old entry → blocking regression", async () => {
    const summary = await runDiffHarness([target({ parseNew: async () => [] })]);

    expect(summary.blocking).toBe(true);
    expect(summary.reports[0]?.report?.regressions).toHaveLength(1);
  });

  test("parseNew throws → fixture recorded as error, blocking", async () => {
    const summary = await runDiffHarness([
      target({
        parseNew: async () => {
          throw new Error("boom");
        },
      }),
    ]);

    expect(summary.blocking).toBe(true);
    expect(summary.reports[0]?.error).toBe("boom");
    expect(summary.reports[0]?.report).toBeUndefined();
  });

  test("missing fixturesDir → one error report, blocking (no crash)", async () => {
    const summary = await runDiffHarness([target({ fixturesDir: join(dir, "does-not-exist") })]);

    expect(summary.blocking).toBe(true);
    expect(summary.reports).toHaveLength(1);
    expect(summary.reports[0]?.error).toContain("not a directory");
  });

  test("sessionUidFor override is passed to parseNew", async () => {
    const seen: string[] = [];
    await runDiffHarness([
      target({
        sessionUidFor: (path) => `uid:${path}`,
        parseNew: async (_path, sessionUid) => {
          seen.push(sessionUid);
          return [entry("new-1", "hello")];
        },
      }),
    ]);

    expect(seen.every((uid) => uid.startsWith("uid:"))).toBe(true);
  });
});
