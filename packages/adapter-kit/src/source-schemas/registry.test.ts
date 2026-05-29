import { describe, expect, test } from "bun:test";
import { getSourceValidator } from "./registry.ts";

const REGISTERED: [string, string][] = [
  ["codex", "v0.128"],
  ["pi", "v1"],
  ["claude-code", "v1"],
];

describe("getSourceValidator", () => {
  for (const [agent, version] of REGISTERED) {
    test(`${agent}/${version} has a compiled validator`, () => {
      expect(getSourceValidator(agent, version)).toBeDefined();
    });
  }

  test("unknown agent/version returns undefined", () => {
    expect(getSourceValidator("nonesuch", "v1")).toBeUndefined();
    expect(getSourceValidator("codex", "v9.99")).toBeUndefined();
  });

  test("repeated lookup returns the same validator instance (cache)", () => {
    const first = getSourceValidator("codex", "v0.128");
    const second = getSourceValidator("codex", "v0.128");
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });
});
