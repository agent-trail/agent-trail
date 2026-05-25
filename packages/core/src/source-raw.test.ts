import { afterEach, expect, test } from "bun:test";
import { BEARER_TOKEN, CREDENTIAL_PATTERNS } from "./secret-patterns.ts";
import { enforceSourceRawSize, redactValue } from "./source-raw.ts";

afterEach(() => {
  delete process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP;
});

test("redactValue replaces a Bearer token nested in an object", () => {
  const input = {
    headers: { authorization: "Bearer abcdefABCDEF0123456789xyzXYZ" },
    body: "ok",
  };
  const out = redactValue(input);
  expect((out as typeof input).headers.authorization).toBe("Bearer [TOKEN]");
  expect((out as typeof input).body).toBe("ok");
  expect((out as object) === input).toBe(false);
  expect(input.headers.authorization).toBe("Bearer abcdefABCDEF0123456789xyzXYZ");
});

test("redactValue walks arrays and replaces inside elements", () => {
  const input = ["safe", { token: "sk-ant-AbCdEfGhIjKlMnOpQrStUv0123456789" }];
  const out = redactValue(input) as unknown[];
  expect((out[1] as { token: string }).token).toBe("[ANTHROPIC_KEY]");
});

test("redactValue passes through primitive values unchanged", () => {
  expect(redactValue(42)).toBe(42);
  expect(redactValue(null)).toBe(null);
  expect(redactValue("plain text")).toBe("plain text");
});

test("redactValue redacts a top-level string containing a credential", () => {
  expect(redactValue("Authorization: Bearer abcdefABCDEF0123456789xyzXYZ")).toBe(
    "Authorization: Bearer [TOKEN]",
  );
});

test("CREDENTIAL_PATTERNS includes BEARER_TOKEN", () => {
  expect(CREDENTIAL_PATTERNS).toContain(BEARER_TOKEN);
});

test("enforceSourceRawSize returns the value as-is when under the hard cap", () => {
  const value = { envelope: { id: "e", body: "x".repeat(3000) } };
  const { value: out, elided, leavesTrimmed } = enforceSourceRawSize(value);
  expect(elided).toBe(false);
  expect(leavesTrimmed).toBe(0);
  expect(out).toBe(value);
});

test("enforceSourceRawSize trims only the largest leaf when one trim is enough to fit", () => {
  const value = {
    id: "env-1",
    role: "assistant",
    smallText: "y".repeat(500),
    bigText: "x".repeat(5000),
  };
  const {
    value: out,
    elided,
    leavesTrimmed,
  } = enforceSourceRawSize(value, {
    hardCapBytes: 1024,
  });
  expect(elided).toBe(false);
  expect(leavesTrimmed).toBe(1);
  const cast = out as {
    id: string;
    role: string;
    smallText: string;
    bigText: unknown;
  };
  expect(cast.id).toBe("env-1");
  expect(cast.role).toBe("assistant");
  expect(cast.smallText).toBe("y".repeat(500));
  expect(cast.bigText).toEqual({ elided: true, size_bytes: 5000 });
});

test("enforceSourceRawSize trims additional leaves only as needed", () => {
  const value = {
    a: "a".repeat(2000),
    b: "b".repeat(1500),
    c: "c".repeat(1000),
  };
  const {
    value: out,
    elided,
    leavesTrimmed,
  } = enforceSourceRawSize(value, {
    hardCapBytes: 2200,
  });
  expect(elided).toBe(false);
  expect(leavesTrimmed).toBe(2);
  const cast = out as { a: unknown; b: unknown; c: string };
  expect(cast.a).toEqual({ elided: true, size_bytes: 2000 });
  expect(cast.b).toEqual({ elided: true, size_bytes: 1500 });
  expect(cast.c).toBe("c".repeat(1000));
});

test("enforceSourceRawSize falls back to whole-value elide when no leaves remain but value still exceeds cap", () => {
  const longArray = Array.from({ length: 200 }, (_, i) => `tag${i}`);
  const value = { envelope: { id: "env", tags: longArray } };
  const original = JSON.stringify(value);
  const { value: out, elided } = enforceSourceRawSize(value, { hardCapBytes: 100 });
  expect(elided).toBe(true);
  expect(out).toEqual({ elided: true, size_bytes: Buffer.byteLength(original, "utf8") });
});

test("enforceSourceRawSize preserves the value verbatim when hardCapBytes is null", () => {
  const value = { envelope: { body: "x".repeat(50_000) } };
  const {
    value: out,
    elided,
    leavesTrimmed,
  } = enforceSourceRawSize(value, {
    hardCapBytes: null,
  });
  expect(elided).toBe(false);
  expect(leavesTrimmed).toBe(0);
  expect(out).toBe(value);
});

test("enforceSourceRawSize honors AGENT_TRAIL_SOURCE_RAW_HARD_CAP=disabled", () => {
  process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP = "disabled";
  const value = { envelope: { body: "x".repeat(50_000) } };
  const { value: out, elided, leavesTrimmed } = enforceSourceRawSize(value);
  expect(elided).toBe(false);
  expect(leavesTrimmed).toBe(0);
  expect(out).toBe(value);
});

test("enforceSourceRawSize keeps a top-level string under the cap verbatim", () => {
  const value = "short string";
  const { value: out, elided, leavesTrimmed } = enforceSourceRawSize(value);
  expect(elided).toBe(false);
  expect(leavesTrimmed).toBe(0);
  expect(out).toBe(value);
});

test("enforceSourceRawSize elides a top-level string that exceeds the hard cap", () => {
  const value = "x".repeat(50_000);
  const { value: out, elided, leavesTrimmed } = enforceSourceRawSize(value);
  expect(elided).toBe(true);
  expect(leavesTrimmed).toBe(0);
  expect(out).toEqual({
    elided: true,
    size_bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
  });
});

test("enforceSourceRawSize honors AGENT_TRAIL_SOURCE_RAW_HARD_CAP numeric override", () => {
  process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP = "256";
  const value = { envelope: { body: "x".repeat(500) } };
  const { elided, leavesTrimmed } = enforceSourceRawSize(value);
  expect(elided).toBe(false);
  expect(leavesTrimmed).toBe(1);
});
