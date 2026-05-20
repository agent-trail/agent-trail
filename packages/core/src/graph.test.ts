import { expect, test } from "bun:test";
import { validateTrailGraph } from "./graph.ts";
import { computeContentHash } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";

function record(line: number, value: Record<string, unknown>): JsonlRecord {
  return { line, raw: JSON.stringify(value), value };
}

function header(line = 1, overrides: Record<string, unknown> = {}): JsonlRecord {
  return record(line, {
    type: "session",
    schema_version: "0.1.0",
    id: "sess1",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
    ...overrides,
  });
}

test("accepts a minimal valid linear trail with no parent_ids", () => {
  const diagnostics = validateTrailGraph([
    record(1, {
      type: "session",
      schema_version: "0.1.0",
      id: "sess1",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
    record(2, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ]);

  expect(diagnostics).toEqual([]);
});

test("throws on invalid validation profiles", () => {
  expect(() => validateTrailGraph([header()], { profile: "reader_tolerant" as never })).toThrow(
    'Validation profile must be "strict" or "reader-tolerant"',
  );
});

test("emits missing_header at line 0 when the record list is empty", () => {
  const diagnostics = validateTrailGraph([]);

  expect(diagnostics).toEqual([
    {
      line: 0,
      path: "",
      severity: "error",
      code: "missing_header",
      message: 'First line must be a session header with type "session" and schema_version "0.1.0"',
    },
  ]);
});

test("emits missing_header when line 1 is not a session header", () => {
  const diagnostics = validateTrailGraph([
    record(1, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "",
      severity: "error",
      code: "missing_header",
      message: 'First line must be a session header with type "session" and schema_version "0.1.0"',
    },
  ]);
});

test("emits missing_header when line 1 has the wrong schema_version", () => {
  const diagnostics = validateTrailGraph([
    record(1, {
      type: "session",
      schema_version: "0.2.0",
      id: "sess1",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "",
      severity: "error",
      code: "missing_header",
      message: 'First line must be a session header with type "session" and schema_version "0.1.0"',
    },
  ]);
});

test("emits unknown_parent_id when an entry's parent_id is not in the file", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "agent_message",
      id: "evta2",
      parent_id: "missing-id",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hi" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 2,
      path: "/parent_id",
      severity: "error",
      code: "unknown_parent_id",
      message: 'parent_id "missing-id" does not reference an id in this file',
    },
  ]);
});

test("emits parent_cycle for every node in a two-node parent cycle", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "agent_message",
      id: "a",
      parent_id: "b",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "a" },
    }),
    record(3, {
      type: "agent_message",
      id: "b",
      parent_id: "a",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { text: "b" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 2,
      path: "/parent_id",
      severity: "error",
      code: "parent_cycle",
      message: 'parent_id chain for id "a" forms a cycle',
    },
    {
      line: 3,
      path: "/parent_id",
      severity: "error",
      code: "parent_cycle",
      message: 'parent_id chain for id "b" forms a cycle',
    },
  ]);
});

test("emits parent_cycle for a self-cycle", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "agent_message",
      id: "loop",
      parent_id: "loop",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "loop" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 2,
      path: "/parent_id",
      severity: "error",
      code: "parent_cycle",
      message: 'parent_id chain for id "loop" forms a cycle',
    },
  ]);
});

test("emits parent_cycle for every node in a three-node cycle", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "agent_message",
      id: "a",
      parent_id: "c",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "a" },
    }),
    record(3, {
      type: "agent_message",
      id: "b",
      parent_id: "a",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { text: "b" },
    }),
    record(4, {
      type: "agent_message",
      id: "c",
      parent_id: "b",
      ts: "2026-05-17T14:00:07.000Z",
      payload: { text: "c" },
    }),
  ]);

  expect(diagnostics.map((d) => ({ line: d.line, code: d.code, id: d.message }))).toEqual([
    { line: 2, code: "parent_cycle", id: 'parent_id chain for id "a" forms a cycle' },
    { line: 3, code: "parent_cycle", id: 'parent_id chain for id "b" forms a cycle' },
    { line: 4, code: "parent_cycle", id: 'parent_id chain for id "c" forms a cycle' },
  ]);
});

test("accepts a valid tree with two children sharing a parent_id", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "user_message",
      id: "root",
      ts: "2026-05-17T14:00:00.000Z",
      payload: { text: "root" },
    }),
    record(3, {
      type: "agent_message",
      id: "leftA",
      parent_id: "root",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "left" },
    }),
    record(4, {
      type: "agent_message",
      id: "leftB",
      parent_id: "leftA",
      ts: "2026-05-17T14:00:06.000Z",
      payload: { text: "left2" },
    }),
    record(5, {
      type: "agent_message",
      id: "rightA",
      parent_id: "root",
      ts: "2026-05-17T14:00:07.000Z",
      payload: { text: "right" },
    }),
  ]);

  expect(diagnostics).toEqual([]);
});

test("emits header_has_parent_id when the header carries a non-null parent_id", () => {
  const diagnostics = validateTrailGraph([
    header(1, { parent_id: "anything" }),
    record(2, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/parent_id",
      severity: "error",
      code: "header_has_parent_id",
      message: "Session header must not have a parent_id",
    },
  ]);
});

test("does not flag entries with unknown parent_id as cyclic", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "agent_message",
      id: "orphan",
      parent_id: "ghost",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "orphan" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 2,
      path: "/parent_id",
      severity: "error",
      code: "unknown_parent_id",
      message: 'parent_id "ghost" does not reference an id in this file',
    },
  ]);
});

test("flags duplicate_id when an entry reuses the session header id", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "user_message",
      id: "sess1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 2,
      path: "/id",
      severity: "error",
      code: "duplicate_id",
      message: 'Duplicate id "sess1"; first seen on line 1',
    },
  ]);
});

test("treats parent_id pointing at the session header as an unknown reference", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "agent_message",
      id: "evta1",
      parent_id: "sess1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hi" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 2,
      path: "/parent_id",
      severity: "error",
      code: "unknown_parent_id",
      message: 'parent_id "sess1" does not reference an id in this file',
    },
  ]);
});

test("emits duplicate_id at the second occurrence and keeps the first", () => {
  const diagnostics = validateTrailGraph([
    header(),
    record(2, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
    record(3, {
      type: "agent_message",
      id: "evta1",
      ts: "2026-05-17T14:00:07.000Z",
      payload: { text: "hi" },
    }),
  ]);

  expect(diagnostics).toEqual([
    {
      line: 3,
      path: "/id",
      severity: "error",
      code: "duplicate_id",
      message: 'Duplicate id "evta1"; first seen on line 2',
    },
  ]);
});

test("does not emit a hash diagnostic when content_hash is absent", () => {
  const diagnostics = validateTrailGraph([header()]);

  expect(diagnostics).toEqual([]);
});

test("does not emit a hash diagnostic when content_hash is <pending>", () => {
  const diagnostics = validateTrailGraph([header(1, { content_hash: "<pending>" })]);

  expect(diagnostics).toEqual([]);
});

test("does not emit a hash diagnostic when content_hash matches canonical bytes", () => {
  const baseRecords = [
    header(),
    record(2, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ];
  const digest = computeContentHash(baseRecords);

  const diagnostics = validateTrailGraph([
    header(1, { content_hash: digest }),
    baseRecords[1] as JsonlRecord,
  ]);

  expect(diagnostics).toEqual([]);
});

test("emits content_hash_mismatch when finalized hash does not match canonical bytes", () => {
  const wrongDigest = "a".repeat(64);
  const records = [
    header(1, { content_hash: wrongDigest }),
    record(2, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ];
  const computed = computeContentHash(records);

  const diagnostics = validateTrailGraph(records);

  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "content_hash_mismatch",
      message: `content_hash does not match canonical bytes (computed ${computed})`,
    },
  ]);
});

test("reader-tolerant profile warns on content_hash_mismatch", () => {
  const wrongDigest = "a".repeat(64);
  const records = [
    header(1, { content_hash: wrongDigest }),
    record(2, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    }),
  ];
  const computed = computeContentHash(records);

  const diagnostics = validateTrailGraph(records, { profile: "reader-tolerant" });

  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "warning",
      code: "content_hash_mismatch",
      message: `content_hash does not match canonical bytes (computed ${computed})`,
    },
  ]);
});

test("emits content_hash_invalid when content_hash is not 64 lowercase hex characters", () => {
  const diagnostics = validateTrailGraph([header(1, { content_hash: "deadbeef" })]);

  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "content_hash_invalid",
      message: "content_hash must be 64 lowercase hex characters",
    },
  ]);
});

test("reader-tolerant profile still errors on invalid content_hash syntax", () => {
  const diagnostics = validateTrailGraph([header(1, { content_hash: "deadbeef" })], {
    profile: "reader-tolerant",
  });

  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "content_hash_invalid",
      message: "content_hash must be 64 lowercase hex characters",
    },
  ]);
});

test("does not emit a hash diagnostic when the header itself is invalid", () => {
  const diagnostics = validateTrailGraph([
    record(1, {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:00.000Z",
      payload: { text: "hi" },
      content_hash: "a".repeat(64),
    }),
  ]);

  expect(diagnostics.map((d) => d.code)).toEqual(["missing_header"]);
});
