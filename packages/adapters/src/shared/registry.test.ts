import { describe, expect, test } from "bun:test";
import { defaultTrailAdapters } from "./registry.ts";

describe("defaultTrailAdapters", () => {
  test("keeps the canonical adapter order and returns a fresh array", () => {
    const first = defaultTrailAdapters();
    const second = defaultTrailAdapters();

    expect(first.map((adapter) => adapter.name)).toEqual([
      "claude-code",
      "codex",
      "opencode",
      "pi",
    ]);
    expect(first).not.toBe(second);
  });
});
