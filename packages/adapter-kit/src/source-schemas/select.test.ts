import { describe, expect, test } from "bun:test";
import { selectSchemaVersion } from "./select.ts";

describe("selectSchemaVersion", () => {
  test("in-range codex cli_version resolves to its schema version", () => {
    expect(selectSchemaVersion("codex", "0.128.4")).toBe("v0.128");
  });

  test("out-of-range version falls back to meta.fallback", () => {
    expect(selectSchemaVersion("codex", "0.99.0")).toBe("v0.128");
  });

  test("missing version resolves to undefined", () => {
    expect(selectSchemaVersion("codex", undefined)).toBeUndefined();
  });

  test("unknown agent resolves to undefined", () => {
    expect(selectSchemaVersion("nonesuch", "1.0.0")).toBeUndefined();
  });

  test("pi numeric version coerces and matches its range", () => {
    expect(selectSchemaVersion("pi", 3)).toBe("v1");
  });

  test("claude-code prerelease version matches its range", () => {
    expect(selectSchemaVersion("claude-code", "1.0.0-synthetic")).toBe("v1");
  });
});
