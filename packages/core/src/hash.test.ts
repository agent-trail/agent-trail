import { expect, test } from "bun:test";
import {
  computeContentHash,
  computeTrailEnvelopeContentHash,
  stampTrail,
  verifyContentHash,
  verifyTrailEnvelopeContentHash,
} from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";

function record(line: number, value: Record<string, unknown>): JsonlRecord {
  return { line, raw: JSON.stringify(value), value };
}

function header(overrides: Record<string, unknown> = {}): JsonlRecord {
  return record(1, {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
    ...overrides,
  });
}

function envelope(overrides: Record<string, unknown> = {}): JsonlRecord {
  return record(1, {
    type: "trail",
    schema_version: "0.1.0",
    id: "01HTRACE000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    producer: "trail-cli/0.3.0",
    ...overrides,
  });
}

function sessionAtLine2(overrides: Record<string, unknown> = {}): JsonlRecord {
  return record(2, {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
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
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ];

  const digest = computeContentHash(records);

  expect(digest).toBe("2be81234cd4d38dd4b40e3b20a30addcebacc06dca1218cb66d97578eecba022");
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

test("computeContentHash targets the session header when an envelope precedes it", () => {
  const records: JsonlRecord[] = [envelope(), sessionAtLine2()];

  const digest = computeContentHash(records);

  expect(digest).toMatch(/^[0-9a-f]{64}$/);
});

test("computeTrailEnvelopeContentHash returns null without an envelope", () => {
  expect(computeTrailEnvelopeContentHash([header()])).toBeNull();
});

test("computeTrailEnvelopeContentHash and computeContentHash pin distinct records", () => {
  const records: JsonlRecord[] = [envelope(), sessionAtLine2()];

  const envelopeDigest = computeTrailEnvelopeContentHash(records);
  const sessionDigest = computeContentHash(records);

  expect(envelopeDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(sessionDigest).toMatch(/^[0-9a-f]{64}$/);
  expect(envelopeDigest).not.toBe(sessionDigest);
});

test("verifyContentHash matches the stamped session digest when an envelope is present", () => {
  const records: JsonlRecord[] = [envelope(), sessionAtLine2()];
  const digest = computeContentHash(records);
  const finalized: JsonlRecord[] = [envelope(), sessionAtLine2({ content_hash: digest })];

  const result = verifyContentHash(finalized);

  expect(result).toEqual({ status: "match", expected: digest, actual: digest });
});

test("verifyTrailEnvelopeContentHash matches the stamped envelope digest", () => {
  const records: JsonlRecord[] = [envelope(), sessionAtLine2()];
  const digest = computeTrailEnvelopeContentHash(records);
  expect(digest).not.toBeNull();
  const finalized: JsonlRecord[] = [envelope({ content_hash: digest }), sessionAtLine2()];

  const result = verifyTrailEnvelopeContentHash(finalized);

  expect(result).toEqual({ status: "match", expected: digest, actual: digest });
});

test("verifyTrailEnvelopeContentHash flags a mismatched envelope digest", () => {
  const wrong = "a".repeat(64);
  const finalized: JsonlRecord[] = [envelope({ content_hash: wrong }), sessionAtLine2()];
  const computed = computeTrailEnvelopeContentHash(finalized);

  const result = verifyTrailEnvelopeContentHash(finalized);

  expect(result).toEqual({ status: "mismatch", expected: wrong, actual: computed });
});

test("computeContentHash with groupIndex 1 hashes the second session group in isolation", () => {
  const session1 = record(1, {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  });
  const evt1 = record(2, {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hi" },
  });
  const session2 = record(3, {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000002",
    ts: "2026-05-17T14:05:00.000Z",
    agent: { name: "claude-code" },
  });
  const evt2 = record(4, {
    type: "user_message",
    id: "01HEVTA0000000000000000002",
    ts: "2026-05-17T14:05:05.000Z",
    payload: { text: "yo" },
  });

  const multiSessionDigest = computeContentHash([session1, evt1, session2, evt2], {
    groupIndex: 1,
  });
  const standaloneDigest = computeContentHash([session2, evt2]);

  expect(multiSessionDigest).toBe(standaloneDigest);
});

test("computeContentHash with groupIndex 0 still hashes the first group (single-session default)", () => {
  const session1 = record(1, {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  });
  const session2 = record(2, {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000002",
    ts: "2026-05-17T14:01:00.000Z",
    agent: { name: "claude-code" },
  });

  const defaultDigest = computeContentHash([session1, session2]);
  const explicitGroup0 = computeContentHash([session1, session2], { groupIndex: 0 });
  const standaloneFirst = computeContentHash([session1]);

  expect(defaultDigest).toBe(standaloneFirst);
  expect(explicitGroup0).toBe(standaloneFirst);
});

test("stampTrail stamps every session header in a multi-session file and the envelope", () => {
  const env = envelope();
  const s1 = record(2, {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  });
  const e1 = record(3, {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hi" },
  });
  const s2 = record(4, {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000002",
    ts: "2026-05-17T14:05:00.000Z",
    agent: { name: "claude-code" },
  });
  const e2 = record(5, {
    type: "user_message",
    id: "01HEVTA0000000000000000002",
    ts: "2026-05-17T14:05:05.000Z",
    payload: { text: "yo" },
  });

  const records: JsonlRecord[] = [env, s1, e1, s2, e2];
  const result = stampTrail(records);

  expect(result.sessionHashes).toHaveLength(2);
  expect(result.sessionHashes[0]).toBe((s1.value as { content_hash: string }).content_hash);
  expect(result.sessionHashes[1]).toBe((s2.value as { content_hash: string }).content_hash);
  expect(result.envelopeHash).toBe((env.value as { content_hash: string }).content_hash);
  expect(verifyContentHash(records).status).toBe("match");
  expect(verifyContentHash(records, { groupIndex: 1 }).status).toBe("match");
  expect(verifyTrailEnvelopeContentHash(records).status).toBe("match");
});

test("verifyContentHash returns missing when the header itself is missing or invalid", () => {
  const noHeader = verifyContentHash([]);
  const wrongType = verifyContentHash([
    record(1, {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      payload: { text: "hi" },
    }),
  ]);

  expect(noHeader).toEqual({ status: "missing", expected: null, actual: null });
  expect(wrongType).toEqual({ status: "missing", expected: null, actual: null });
});
