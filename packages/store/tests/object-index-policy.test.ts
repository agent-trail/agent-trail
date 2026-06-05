import { expect, test } from "bun:test";
import type { JsonlRecord } from "@agent-trail/core";
import { computeContentHash, computeTrailEnvelopeContentHash } from "@agent-trail/core";
import {
  finalizedObjectIndexPolicy,
  finalizedObjectIndexRowForHash,
} from "../src/object-index-policy.ts";

function record(line: number, value: Record<string, unknown>): JsonlRecord {
  return { line, raw: JSON.stringify(value), value };
}

function mixedSessionRecords(): JsonlRecord[] {
  const firstPending = [
    record(1, {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000A01",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
      session_uid: "01HSESSXA0000000000000A001",
    }),
    record(2, {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hi" },
    }),
    record(3, {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000A02",
      ts: "2026-05-17T14:05:00.000Z",
      agent: { name: "claude-code" },
      session_uid: "01HSESSXA0000000000000A002",
    }),
    record(4, {
      type: "user_message",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-17T14:05:05.000Z",
      payload: { text: "ok" },
    }),
  ];
  const firstHash = computeContentHash(firstPending, { groupIndex: 0 });
  return [
    record(1, { ...firstPending[0]?.value, content_hash: firstHash }),
    ...firstPending.slice(1),
  ];
}

test("finalizedObjectIndexPolicy skips pending sibling sessions", () => {
  const records = mixedSessionRecords();
  const firstHash = records[0]?.value.content_hash as string;

  const policy = finalizedObjectIndexPolicy(records);

  expect(policy.primaryHash).toBe(firstHash);
  expect(policy.rows).toEqual([
    {
      contentHash: firstHash,
      kind: "session",
      session_uid: "01HSESSXA0000000000000A001",
    },
  ]);
  expect(finalizedObjectIndexRowForHash(records, firstHash)).toEqual(policy.rows[0]);
  expect(finalizedObjectIndexRowForHash(records, "0".repeat(64))).toBeUndefined();
});

test("finalizedObjectIndexPolicy keeps finalized envelope while skipping pending session rows", () => {
  const sessionRecords = mixedSessionRecords();
  const envelopePending = record(1, {
    type: "trail",
    schema_version: "0.1.0",
    id: "01HTRA0X00000000000000A001",
    ts: "2026-05-17T14:00:00.000Z",
    producer: "trail-cli/0.3.0",
  });
  const recordsWithEnvelope = [
    envelopePending,
    ...sessionRecords.map((entry) => ({ ...entry, line: entry.line + 1 })),
  ];
  const envelopeHash = computeTrailEnvelopeContentHash(recordsWithEnvelope) as string;
  const records = [record(1, { ...envelopePending.value, content_hash: envelopeHash })].concat(
    recordsWithEnvelope.slice(1),
  );
  const firstSessionHash = records[1]?.value.content_hash as string;

  const policy = finalizedObjectIndexPolicy(records);

  expect(policy.primaryHash).toBe(envelopeHash);
  expect(policy.rows).toEqual([
    {
      contentHash: firstSessionHash,
      kind: "session",
      session_uid: "01HSESSXA0000000000000A001",
    },
    {
      contentHash: envelopeHash,
      kind: "trail",
      session_uid: null,
    },
  ]);
  expect(finalizedObjectIndexRowForHash(records, envelopeHash)).toEqual(policy.rows[1]);
});
