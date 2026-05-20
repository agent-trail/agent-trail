import { expect, test } from "bun:test";
import { computeContentHash, verifyContentHash } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";

function record(line: number, value: Record<string, unknown>): JsonlRecord {
  return { line, raw: JSON.stringify(value), value };
}

function header(overrides: Record<string, unknown> = {}): JsonlRecord {
  return record(1, {
    type: "session",
    schema_version: "0.1.0",
    id: "sess1",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
    ...overrides,
  });
}

test("computeContentHash returns a 64-char lowercase hex sha-256 digest", () => {
  const digest = computeContentHash([header()]);

  expect(digest).toMatch(/^[0-9a-f]{64}$/);
});

test("computeContentHash produces a stable digest for a header + user_message trail", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ];

  const digest = computeContentHash(records);

  expect(digest).toBe("d0b680cb57b2229e9b0530afef58b23ce19f037e68713c998763d36b1825cad8");
});

test("computeContentHash ignores any existing header content_hash value", () => {
  const baseline = computeContentHash([header()]);
  const withWrongHash = computeContentHash([header({ content_hash: "deadbeef".repeat(8) })]);
  const withPending = computeContentHash([header({ content_hash: "<pending>" })]);

  expect(withWrongHash).toBe(baseline);
  expect(withPending).toBe(baseline);
});

test("verifyContentHash returns match when header carries the freshly-computed digest", () => {
  const records = [header()];
  const digest = computeContentHash(records);
  const finalized = [header({ content_hash: digest })];

  const result = verifyContentHash(finalized);

  expect(result).toEqual({ status: "match", expected: digest, actual: digest });
});

test("verifyContentHash returns mismatch when the header carries a wrong digest", () => {
  const wrongDigest = "a".repeat(64);
  const finalized = [header({ content_hash: wrongDigest })];
  const computed = computeContentHash(finalized);

  const result = verifyContentHash(finalized);

  expect(result).toEqual({ status: "mismatch", expected: wrongDigest, actual: computed });
  expect(computed).not.toBe(wrongDigest);
});

test("verifyContentHash returns pending for the <pending> sentinel", () => {
  const result = verifyContentHash([header({ content_hash: "<pending>" })]);

  expect(result).toEqual({ status: "pending", expected: "<pending>", actual: null });
});

test("verifyContentHash returns missing when content_hash is absent", () => {
  const result = verifyContentHash([header()]);

  expect(result).toEqual({ status: "missing", expected: null, actual: null });
});

test("verifyContentHash returns invalid for short or non-lowercase hex strings", () => {
  const short = verifyContentHash([header({ content_hash: "deadbeef" })]);
  const upper = verifyContentHash([header({ content_hash: "A".repeat(64) })]);

  expect(short).toEqual({ status: "invalid", expected: "deadbeef", actual: null });
  expect(upper).toEqual({ status: "invalid", expected: "A".repeat(64), actual: null });
});

test("verifyContentHash returns missing when the header itself is missing or invalid", () => {
  const noHeader = verifyContentHash([]);
  const wrongType = verifyContentHash([
    record(1, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:00.000Z",
      payload: { text: "hi" },
    }),
  ]);

  expect(noHeader).toEqual({ status: "missing", expected: null, actual: null });
  expect(wrongType).toEqual({ status: "missing", expected: null, actual: null });
});
