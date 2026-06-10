import { expect, test } from "bun:test";
import { validateTrailString } from "./index.ts";

test("multi-session parent_id references stay scoped to their session group", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"00000000-0000-4000-8000-000000000101","ts":"2026-06-01T10:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"00000000-0000-4000-8000-000000000102","ts":"2026-06-01T10:00:01.000Z","payload":{"text":"parent group"}}',
      '{"type":"session","schema_version":"0.1.0","id":"00000000-0000-4000-8000-000000000201","ts":"2026-06-01T10:01:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"00000000-0000-4000-8000-000000000202","parent_id":"00000000-0000-4000-8000-000000000102","ts":"2026-06-01T10:01:01.000Z","payload":{"text":"child group cannot reuse parent id"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 4,
    path: "/parent_id",
    severity: "error",
    code: "unknown_parent_id",
    message:
      'parent_id "00000000-0000-4000-8000-000000000102" does not reference an id in this file',
  });
});

test("reader-tolerant parsing downgrades compatible payload additions only", async () => {
  const trail = [
    '{"type":"session","schema_version":"0.1.0","id":"00000000-0000-4000-8000-000000000301","ts":"2026-06-01T10:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"00000000-0000-4000-8000-000000000302","ts":"2026-06-01T10:00:01.000Z","payload":{"text":"hello","future_field":{"kept":true}}}',
  ].join("\n");

  const strict = await validateTrailString(trail);
  expect(strict).toContainEqual({
    line: 2,
    path: "/payload/future_field",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });

  const tolerant = await validateTrailString(trail, { profile: "reader-tolerant" });
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/payload/future_field",
      severity: "warning",
      code: "reader_tolerant_unknown_payload_field",
      message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
    },
  ]);
});

test("reader-tolerant parsing preserves invalid timestamps on tolerated payload additions", async () => {
  const trail = [
    '{"type":"session","schema_version":"0.1.0","id":"00000000-0000-4000-8000-000000000401","ts":"2026-06-01T10:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"00000000-0000-4000-8000-000000000402","ts":"2026-02-30T00:00:00.000Z","payload":{"text":"hello","future_field":{"kept":true}}}',
  ].join("\n");

  const tolerant = await validateTrailString(trail, { profile: "reader-tolerant" });
  expect(tolerant).toContainEqual({
    line: 2,
    path: "/ts",
    severity: "error",
    code: "invalid_timestamp",
    message: "Timestamp must be a valid UTC ISO-8601 value with millisecond precision",
  });
  expect(tolerant).toContainEqual({
    line: 2,
    path: "/payload/future_field",
    severity: "warning",
    code: "reader_tolerant_unknown_payload_field",
    message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
  });
});

test("reader-tolerant parsing preserves invalid timestamps on unknown records", async () => {
  const trail = [
    '{"type":"session","schema_version":"0.1.0","id":"00000000-0000-4000-8000-000000000501","ts":"2026-06-01T10:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"future_event","id":"00000000-0000-4000-8000-000000000502","ts":"2026-02-30T00:00:00.000Z","payload":{"future":true}}',
  ].join("\n");

  const tolerant = await validateTrailString(trail, { profile: "reader-tolerant" });
  expect(tolerant).toContainEqual({
    line: 2,
    path: "/type",
    severity: "warning",
    code: "reader_tolerant_unknown_record",
    message: 'Unknown event type "future_event" preserved for reader-tolerant parsing',
  });
  expect(tolerant).toContainEqual({
    line: 2,
    path: "/ts",
    severity: "error",
    code: "invalid_timestamp",
    message: "Timestamp must be a valid UTC ISO-8601 value with millisecond precision",
  });
});
