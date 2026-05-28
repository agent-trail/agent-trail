import { expect, test } from "bun:test";
import schema from "@agent-trail/schema" with { type: "json" };
import { sourceRawSecretDiagnostics } from "./business-rules.ts";
import { computeContentHash } from "./hash.ts";
import {
  parseJsonlString,
  validateTrailStream,
  validateTrailString,
  validateWriterStrictRecord,
  validateWriterStrictSchemaJsonlStream,
  validateWriterStrictSchemaJsonlString,
} from "./index.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { implementedEventTypes } from "./validation.ts";

test("accepts the minimal writer-strict session header", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    value: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("accepts a minimal writer-strict event after the header line", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    value: {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("rejects a writer-strict header with the wrong schema version", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: '{"type":"session","schema_version":"0.2.0","id":"01HSESS0000000000000000001","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    value: {
      type: "session",
      schema_version: "0.2.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/schema_version",
      severity: "error",
      code: "const",
      message: "must be equal to constant",
    },
  ]);
});

test("reports a line-aware diagnostic path for an invalid event payload", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{}}',
    value: {
      type: "user_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: {},
    },
  });

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "required",
    message: "must have required property 'text'",
  });
});

test("accepts a valid minimal trail through the schema JSONL string wrapper", async () => {
  const diagnostics = await validateWriterStrictSchemaJsonlString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"agent_message","id":"01HEVTA0000000000000000002","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("converts JSONL parse failures into writer-strict diagnostics", async () => {
  const diagnostics = await validateWriterStrictSchemaJsonlString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message"',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([
    {
      line: 2,
      path: "",
      severity: "error",
      code: "invalid_json",
      message: "Invalid JSON on line 2",
    },
  ]);
});

test("reports invalid headers through the schema JSONL string wrapper", async () => {
  const diagnostics = await validateWriterStrictSchemaJsonlString(
    '{"type":"session","schema_version":"0.2.0","id":"01HSESS0000000000000000001","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
  );

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/schema_version",
    severity: "error",
    code: "const",
    message: "must be equal to constant",
  });
});

test("reports invalid events through the schema JSONL stream wrapper", async () => {
  const diagnostics = await collect(
    validateWriterStrictSchemaJsonlStream(
      chunks([
        '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}\n',
        '{"type":"tool_call","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"tool":"file_read","args":{}}}',
      ]),
    ),
  );

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/args/path",
    severity: "error",
    code: "required",
    message: "must have required property 'path'",
  });
});

test("validateTrailString returns no diagnostics for a valid linear trail", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"agent_message","id":"01HEVTA0000000000000000002","parent_id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("implemented event validator list stays aligned with schema event refs", () => {
  const actual: string[] = [...implementedEventTypes].sort();

  expect(actual).toEqual(schemaImplementedEventRefs().sort());
});

test("invalid validation profiles throw instead of changing validation behavior", async () => {
  const text = [
    '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello","future_field":true}}',
  ].join("\n");

  await expect(validateTrailString(text, { profile: "reader_tolerant" as never })).rejects.toThrow(
    'Validation profile must be "strict" or "reader-tolerant"',
  );
  await expect(
    collect(validateTrailStream(chunks([text]), { profile: "reader_tolerant" as never })),
  ).rejects.toThrow('Validation profile must be "strict" or "reader-tolerant"');
});

test("reader-tolerant profile accepts compatible patch schema versions with a warning", async () => {
  const text = [
    '{"type":"session","schema_version":"0.1.1","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
  ].join("\n");

  const strictDiagnostics = await validateTrailString(text);
  expect(strictDiagnostics).toContainEqual({
    line: 1,
    path: "/schema_version",
    severity: "error",
    code: "const",
    message: "must be equal to constant",
  });
  expect(strictDiagnostics).toContainEqual({
    line: 1,
    path: "",
    severity: "error",
    code: "missing_header",
    message: 'First line must be a session header with type "session" and schema_version "0.1.0"',
  });

  const tolerantDiagnostics = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerantDiagnostics).toEqual([
    {
      line: 1,
      path: "/schema_version",
      severity: "warning",
      code: "reader_tolerant_schema_version",
      message: 'schema_version "0.1.1" accepted by reader-tolerant patch compatibility',
    },
  ]);
});

test("reader-tolerant profile warns for unknown payload fields that strict rejects", async () => {
  const text = [
    '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello","future_field":true}}',
  ].join("\n");

  const strictDiagnostics = await validateTrailString(text);
  expect(strictDiagnostics).toContainEqual({
    line: 2,
    path: "/payload/future_field",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });

  const tolerantDiagnostics = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerantDiagnostics).toContainEqual({
    line: 2,
    path: "/payload/future_field",
    severity: "warning",
    code: "reader_tolerant_unknown_payload_field",
    message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
  });
  expect(tolerantDiagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
});

test("reader-tolerant profile warns for nested unknown payload fields", async () => {
  const text = [
    '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello","attachments":[{"kind":"file","future_field":true}]}}',
  ].join("\n");

  const tolerantDiagnostics = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerantDiagnostics).toEqual([
    {
      line: 2,
      path: "/payload/attachments/0/future_field",
      severity: "warning",
      code: "reader_tolerant_unknown_payload_field",
      message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
    },
  ]);
});

test("reader-tolerant profile keeps non-extension payload errors strict", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":42}}',
    ].join("\n"),
    { profile: "reader-tolerant" },
  );

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "type",
    message: "must be string",
  });
});

test("reader-tolerant profile preserves and warns for unknown future records", async () => {
  const text = [
    '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"future_event","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"future":true}}',
  ].join("\n");

  const records = await parseJsonlString(text);
  expect(records[1]).toEqual({
    line: 2,
    raw: '{"type":"future_event","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"future":true}}',
    value: {
      type: "future_event",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { future: true },
    },
  });

  const tolerantDiagnostics = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerantDiagnostics).toEqual([
    {
      line: 2,
      path: "/type",
      severity: "warning",
      code: "reader_tolerant_unknown_record",
      message: 'Unknown event type "future_event" preserved for reader-tolerant parsing',
    },
  ]);
});

test("reader-tolerant profile preserves reserved future event types", async () => {
  const text = [
    '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"error","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"future":true}}',
  ].join("\n");

  const tolerantDiagnostics = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerantDiagnostics).toEqual([
    {
      line: 2,
      path: "/type",
      severity: "warning",
      code: "reader_tolerant_unknown_record",
      message: 'Unknown event type "error" preserved for reader-tolerant parsing',
    },
  ]);
});

test("validateTrailString reports both per-line and whole-file diagnostics", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"agent_message","id":"01HEVTA0000000000000000001","ts":"not-a-timestamp","payload":{"text":"hi"}}',
    ].join("\n"),
  );

  const codes = diagnostics.map((d) => d.code);
  expect(codes).toContain("pattern");
  expect(codes).toContain("duplicate_id");

  const duplicate = diagnostics.find((d) => d.code === "duplicate_id");
  expect(duplicate).toEqual({
    line: 3,
    path: "/id",
    severity: "error",
    code: "duplicate_id",
    message: 'Duplicate id "01HEVTA0000000000000000001"; first seen on line 2',
  });
});

test("validateTrailStream emits graph diagnostics after schema diagnostics", async () => {
  const diagnostics = await collect(
    validateTrailStream(
      chunks([
        '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}\n',
        '{"type":"agent_message","id":"01HN0DE000000000000000000A","parent_id":"01HN0DE000000000000000000B","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"a"}}\n',
        '{"type":"agent_message","id":"01HN0DE000000000000000000B","parent_id":"01HN0DE000000000000000000A","ts":"2026-05-17T14:00:06.000Z","payload":{"text":"b"}}',
      ]),
    ),
  );

  expect(diagnostics.map((d) => d.code)).toEqual(["parent_cycle", "parent_cycle"]);
  expect(diagnostics.map((d) => d.line)).toEqual([2, 3]);
});

test("validateTrailString surfaces JSONL parse errors and still runs graph checks on prior records", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"agent_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}',
      '{"type":"user_message"',
    ].join("\n"),
  );

  const parseError = diagnostics.find((d) => d.code === "invalid_json");
  expect(parseError).toEqual({
    line: 4,
    path: "",
    severity: "error",
    code: "invalid_json",
    message: "Invalid JSON on line 4",
  });

  const duplicate = diagnostics.find((d) => d.code === "duplicate_id");
  expect(duplicate).toEqual({
    line: 3,
    path: "/id",
    severity: "error",
    code: "duplicate_id",
    message: 'Duplicate id "01HEVTA0000000000000000001"; first seen on line 2',
  });
});

test("leaves whole-file graph checks to later validation layers", async () => {
  const diagnostics = await validateWriterStrictSchemaJsonlString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"agent_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("does not emit content_hash_mismatch when a parse error truncates the records", async () => {
  const headerValue: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  };
  const userValue: Record<string, unknown> = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hello" },
  };
  const agentValue: Record<string, unknown> = {
    type: "agent_message",
    id: "01HEVTA0000000000000000002",
    ts: "2026-05-17T14:00:07.000Z",
    payload: { text: "hi" },
  };
  const droppedValue: Record<string, unknown> = {
    type: "user_message",
    id: "01HEVTA0000000000000000003",
    ts: "2026-05-17T14:00:09.000Z",
    payload: { text: "dropped" },
  };

  const finalizedRecords: JsonlRecord[] = [
    { line: 1, raw: JSON.stringify(headerValue), value: headerValue },
    { line: 2, raw: JSON.stringify(userValue), value: userValue },
    { line: 3, raw: JSON.stringify(agentValue), value: agentValue },
    { line: 4, raw: JSON.stringify(droppedValue), value: droppedValue },
  ];
  const digest = computeContentHash(finalizedRecords);
  const finalizedHeader = { ...headerValue, content_hash: digest };

  const diagnostics = await validateTrailString(
    [
      JSON.stringify(finalizedHeader),
      JSON.stringify(userValue),
      JSON.stringify(agentValue),
      '{"type":"user_message"',
    ].join("\n"),
  );

  expect(diagnostics.map((d) => d.code)).toContain("invalid_json");
  expect(diagnostics.map((d) => d.code)).not.toContain("content_hash_mismatch");
  expect(diagnostics.map((d) => d.code)).not.toContain("content_hash_invalid");
});

test("accepts a header with stream.state open and no content_hash", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: "",
    value: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      stream: { state: "open", started_at: "2026-05-17T14:00:00.000Z" },
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("accepts a header with stream.state closed", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: "",
    value: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      stream: { state: "closed" },
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("rejects a header with non-ISO started_at", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: "",
    value: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      stream: { state: "open", started_at: "yesterday" },
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/stream/started_at",
    severity: "error",
    code: "pattern",
    message: 'must match pattern "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$"',
  });
});

test("rejects a header with stream.state outside the enum", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: "",
    value: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      stream: { state: "halfway" },
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/stream/state",
    severity: "error",
    code: "enum",
    message: "must be equal to one of the allowed values",
  });
});

test("rejects a header with stream missing required state", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: "",
    value: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      stream: {},
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/stream/state",
    severity: "error",
    code: "required",
    message: "must have required property 'state'",
  });
});

test("rejects a header with unknown stream property", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: "",
    value: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      stream: { state: "open", future_field: true },
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/stream/future_field",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });
});

test("accepts a session_end event with reason complete", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: "",
    value: {
      type: "session_end",
      id: "01HEVTEND00000000000000001",
      ts: "2026-05-17T14:00:08.000Z",
      payload: { reason: "complete", final_message_id: "01HEVTA0000000000000000002" },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("rejects a session_end event missing required reason", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: "",
    value: {
      type: "session_end",
      id: "01HEVTEND00000000000000001",
      ts: "2026-05-17T14:00:08.000Z",
      payload: {},
    },
  });

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/reason",
    severity: "error",
    code: "required",
    message: "must have required property 'reason'",
  });
});

test("rejects a session_end event with reason outside the enum", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: "",
    value: {
      type: "session_end",
      id: "01HEVTEND00000000000000001",
      ts: "2026-05-17T14:00:08.000Z",
      payload: { reason: "absolutely_done" },
    },
  });

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/reason",
    severity: "error",
    code: "enum",
    message: "must be equal to one of the allowed values",
  });
});

test("warns when stream.state is open but content_hash is populated", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","content_hash":"0000000000000000000000000000000000000000000000000000000000000000","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/content_hash",
    severity: "warning",
    code: "stream_open_with_content_hash",
    message:
      'Header has stream.state "open" but content_hash is populated; live files should omit content_hash or use "<pending>"',
  });
});

test("does not warn when stream.state is open and content_hash is <pending>", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","content_hash":"<pending>","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
  );

  expect(diagnostics.some((d) => d.code === "stream_open_with_content_hash")).toBe(false);
});

test("warns when stream.state is open and the file contains a session_end event", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"session_end","id":"01HEVTEND00000000000000001","ts":"2026-05-17T14:00:08.000Z","payload":{"reason":"complete"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/type",
    severity: "warning",
    code: "stream_open_with_terminal_event",
    message:
      'Header has stream.state "open" but file contains a terminal "session_end" event; finalize the header before emitting terminal events',
  });
});

test("warns when stream.state is open and the file contains a session_terminated event", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"tool_call","id":"01HEVTC10000000000000001AC","ts":"2026-05-17T14:00:05.000Z","payload":{"tool":"shell_command","args":{"command":"sleep 99"}}}',
      '{"type":"session_terminated","id":"01HEVTTERM00000000000001AB","ts":"2026-05-17T14:00:08.000Z","payload":{"reason":"process_terminated","open_call_ids":["evtc1"]}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/type",
    severity: "warning",
    code: "stream_open_with_terminal_event",
    message:
      'Header has stream.state "open" but file contains a terminal "session_terminated" event; finalize the header before emitting terminal events',
  });
});

test("reader-tolerant profile preserves stream_open_with_terminal_event warning", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"session_end","id":"01HEVTEND00000000000000001","ts":"2026-05-17T14:00:08.000Z","payload":{"reason":"complete"}}',
    ].join("\n"),
    { profile: "reader-tolerant" },
  );

  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/type",
    severity: "warning",
    code: "stream_open_with_terminal_event",
    message:
      'Header has stream.state "open" but file contains a terminal "session_end" event; finalize the header before emitting terminal events',
  });
  expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
});

test("accepts a system_event with kind heartbeat as a streaming liveness ping", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"system_event","id":"01HEVTBEAT0000000000000001","ts":"2026-05-17T14:00:30.000Z","payload":{"kind":"heartbeat","data":{"interval_ms":30000}}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("writer-strict rejects a system_event with a bare unknown kind", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: '{"type":"system_event","id":"01HEVTSE000000000000000001","ts":"2026-05-17T14:00:30.000Z","payload":{"kind":"made_up_thing"}}',
    value: {
      type: "system_event",
      id: "01HEVTSE000000000000000001",
      ts: "2026-05-17T14:00:30.000Z",
      payload: { kind: "made_up_thing" },
    },
  });

  expect(diagnostics.some((d) => d.severity === "error" && d.path === "/payload/kind")).toBe(true);
});

test("writer-strict accepts a system_event with an x-<adapter>/<name> extension kind", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: '{"type":"system_event","id":"01HEVTSE000000000000000002","ts":"2026-05-17T14:00:30.000Z","payload":{"kind":"x-claudecode/notification"}}',
    value: {
      type: "system_event",
      id: "01HEVTSE000000000000000002",
      ts: "2026-05-17T14:00:30.000Z",
      payload: { kind: "x-claudecode/notification" },
    },
  });

  expect(diagnostics).toEqual([]);
});

test.each([
  "session_start",
  "session_end",
  "turn_start",
  "turn_end",
  "subagent_start",
  "subagent_end",
  "pre_tool_use",
  "post_tool_use",
  "hook_fired",
  "permission_request",
  "permission_decision",
  "permission_mode_change",
  "cwd_change",
  "env_snapshot",
  "task_started",
  "task_completed",
  "plan_completed",
  "turn_aborted",
  "tool_decision",
  "hook_progress",
  "queue_operation",
  "heartbeat",
])("writer-strict accepts the reserved system_event kind %s", (kind) => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: `{"type":"system_event","id":"01HEVTSE000000000000000003","ts":"2026-05-17T14:00:30.000Z","payload":{"kind":"${kind}"}}`,
    value: {
      type: "system_event",
      id: "01HEVTSE000000000000000003",
      ts: "2026-05-17T14:00:30.000Z",
      payload: { kind },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("reader-tolerant profile passes a system_event with an unknown x-* kind without diagnostics", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"system_event","id":"01HEVTSE000000000000000004","ts":"2026-05-17T14:00:30.000Z","payload":{"kind":"x-otheragent/foo"}}',
    ].join("\n"),
    { profile: "reader-tolerant" },
  );

  expect(diagnostics).toEqual([]);
});

test("does not warn when stream.state is closed and the file contains session_end", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","stream":{"state":"closed"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"session_end","id":"01HEVTEND00000000000000001","ts":"2026-05-17T14:00:08.000Z","payload":{"reason":"complete"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("stream.state open with <pending> hash skips hash verification cleanly", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","content_hash":"<pending>","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("stream.state open with non-hex content_hash reports both invalid + streaming warning", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","content_hash":"bogus","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/content_hash",
    severity: "error",
    code: "content_hash_invalid",
    message: "content_hash must be 64 lowercase hex characters",
  });
  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/content_hash",
    severity: "warning",
    code: "stream_open_with_content_hash",
    message:
      'Header has stream.state "open" but content_hash is populated; live files should omit content_hash or use "<pending>"',
  });
});

test("stream.state open with mismatched hex content_hash reports mismatch + streaming warning", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","content_hash":"0000000000000000000000000000000000000000000000000000000000000000","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
  );

  expect(
    diagnostics.some((d) => d.code === "content_hash_mismatch" && d.severity === "error"),
  ).toBe(true);
  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/content_hash",
    severity: "warning",
    code: "stream_open_with_content_hash",
    message:
      'Header has stream.state "open" but content_hash is populated; live files should omit content_hash or use "<pending>"',
  });
});

test("stream.state closed with mismatched hash keeps existing content_hash_mismatch and emits no streaming warning", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","content_hash":"0000000000000000000000000000000000000000000000000000000000000000","stream":{"state":"closed"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
  );

  expect(
    diagnostics.some((d) => d.code === "content_hash_mismatch" && d.severity === "error"),
  ).toBe(true);
  expect(diagnostics.some((d) => d.code === "stream_open_with_content_hash")).toBe(false);
});

test("reader-tolerant profile keeps streaming warnings and downgrades hash mismatch to warning", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","content_hash":"0000000000000000000000000000000000000000000000000000000000000000","stream":{"state":"open"},"agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
    { profile: "reader-tolerant" },
  );

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/content_hash",
    severity: "warning",
    code: "stream_open_with_content_hash",
    message:
      'Header has stream.state "open" but content_hash is populated; live files should omit content_hash or use "<pending>"',
  });
  expect(
    diagnostics.some((d) => d.code === "content_hash_mismatch" && d.severity === "warning"),
  ).toBe(true);
  expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
});

test("finalized streaming artifact with matching content_hash validates clean", async () => {
  const headerLive: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    stream: { state: "closed", started_at: "2026-05-17T14:00:00.000Z" },
    agent: { name: "codex-cli" },
  };
  const userValue: Record<string, unknown> = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hello" },
  };
  const agentValue: Record<string, unknown> = {
    type: "agent_message",
    id: "01HEVTA0000000000000000002",
    ts: "2026-05-17T14:00:07.000Z",
    payload: { text: "hi" },
  };
  const endValue: Record<string, unknown> = {
    type: "session_end",
    id: "01HEVTEND00000000000000001",
    ts: "2026-05-17T14:00:08.000Z",
    payload: { reason: "complete", final_message_id: "01HEVTA0000000000000000002" },
  };

  const records: JsonlRecord[] = [
    { line: 1, raw: JSON.stringify(headerLive), value: headerLive },
    { line: 2, raw: JSON.stringify(userValue), value: userValue },
    { line: 3, raw: JSON.stringify(agentValue), value: agentValue },
    { line: 4, raw: JSON.stringify(endValue), value: endValue },
  ];
  const digest = computeContentHash(records);
  const finalizedHeader = { ...headerLive, content_hash: digest };

  const diagnostics = await validateTrailString(
    [
      JSON.stringify(finalizedHeader),
      JSON.stringify(userValue),
      JSON.stringify(agentValue),
      JSON.stringify(endValue),
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("round-trip finalize: live trail transitions to finalized artifact with verifiable hash", async () => {
  const liveHeader: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    stream: { state: "open", started_at: "2026-05-17T14:00:00.000Z" },
    agent: { name: "codex-cli" },
  };
  const userValue: Record<string, unknown> = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hello" },
  };
  const agentValue: Record<string, unknown> = {
    type: "agent_message",
    id: "01HEVTA0000000000000000002",
    ts: "2026-05-17T14:00:07.000Z",
    payload: { text: "hi" },
  };

  const liveDiagnostics = await validateTrailString(
    [JSON.stringify(liveHeader), JSON.stringify(userValue), JSON.stringify(agentValue)].join("\n"),
  );
  expect(liveDiagnostics).toEqual([]);

  const finalizedHeader: Record<string, unknown> = {
    ...liveHeader,
    stream: { state: "closed", started_at: "2026-05-17T14:00:00.000Z" },
  };
  const finalizedRecords: JsonlRecord[] = [
    { line: 1, raw: JSON.stringify(finalizedHeader), value: finalizedHeader },
    { line: 2, raw: JSON.stringify(userValue), value: userValue },
    { line: 3, raw: JSON.stringify(agentValue), value: agentValue },
  ];
  const digest = computeContentHash(finalizedRecords);
  const sealedHeader = { ...finalizedHeader, content_hash: digest };

  const finalizedDiagnostics = await validateTrailString(
    [JSON.stringify(sealedHeader), JSON.stringify(userValue), JSON.stringify(agentValue)].join(
      "\n",
    ),
  );
  expect(finalizedDiagnostics).toEqual([]);

  const tamperedHeader = { ...sealedHeader, ts: "2026-05-17T14:00:01.000Z" };
  const tamperedDiagnostics = await validateTrailString(
    [JSON.stringify(tamperedHeader), JSON.stringify(userValue), JSON.stringify(agentValue)].join(
      "\n",
    ),
  );
  expect(tamperedDiagnostics.some((d) => d.code === "content_hash_mismatch")).toBe(true);
});

test("validateTrailStream processes lines incrementally as chunks arrive", async () => {
  const headerLine =
    '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","stream":{"state":"open"},"agent":{"name":"codex-cli"}}\n';
  const firstEvent =
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}\n';
  const secondEvent =
    '{"type":"agent_message","id":"01HEVTA0000000000000000002","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}\n';

  const diagnostics = await collect(
    validateTrailStream(chunks([headerLine, firstEvent, secondEvent])),
  );

  expect(diagnostics).toEqual([]);
});

test("validateTrailStream surfaces an invalid event mid-stream without losing earlier ones", async () => {
  const headerLine =
    '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","stream":{"state":"open"},"agent":{"name":"codex-cli"}}\n';
  const goodEvent =
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}\n';
  const badEvent =
    '{"type":"tool_call","id":"01HEVTA0000000000000000002","ts":"2026-05-17T14:00:06.000Z","payload":{"tool":"file_read","args":{}}}\n';
  const recoveryEvent =
    '{"type":"agent_message","id":"01HEVTA0000000000000000003","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"continuing"}}\n';

  const diagnostics = await collect(
    validateTrailStream(chunks([headerLine, goodEvent, badEvent, recoveryEvent])),
  );

  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/payload/args/path",
    severity: "error",
    code: "required",
    message: "must have required property 'path'",
  });
  expect(diagnostics.filter((d) => d.severity === "error" && d.line !== 3)).toEqual([]);
});

test("accepts an entry whose source.raw includes envelope_ref string", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: '{"type":"agent_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi"},"source":{"agent":"claude-code","raw":{"envelope_ref":"evta0","block_index":1}}}',
    value: {
      type: "agent_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hi" },
      source: {
        agent: "claude-code",
        raw: { envelope_ref: "evta0", block_index: 1 },
      },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("rejects an entry whose source.raw.envelope_ref is not a string", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: '{"type":"agent_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi"},"source":{"agent":"claude-code","raw":{"envelope_ref":42}}}',
    value: {
      type: "agent_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hi" },
      source: {
        agent: "claude-code",
        raw: { envelope_ref: 42 },
      },
    },
  });

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/source/raw/envelope_ref",
    severity: "error",
    code: "type",
    message: "must be string",
  });
});

test("emits source_raw_oversized warning when source.raw JSON exceeds 8 KB but stays under 32 KB", async () => {
  const big = "x".repeat(10_000);
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      JSON.stringify({
        type: "agent_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "hi" },
        source: { raw: { envelope: { body: big } } },
      }),
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/source/raw",
    severity: "warning",
    code: "source_raw_oversized",
    message: expect.stringContaining("source.raw") as unknown as string,
  });
  expect(diagnostics.some((d) => d.code === "source_raw_oversized_hard")).toBe(false);
});

test("emits source_raw_oversized_hard error when source.raw JSON exceeds 32 KB", async () => {
  const huge = "x".repeat(33_000);
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      JSON.stringify({
        type: "agent_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "hi" },
        source: { raw: { envelope: { body: huge } } },
      }),
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/source/raw",
    severity: "error",
    code: "source_raw_oversized_hard",
    message: expect.stringContaining("hard cap") as unknown as string,
  });
  expect(diagnostics.some((d) => d.code === "source_raw_oversized")).toBe(false);
});

test("emits source_raw_unredacted_secret warning when source.raw contains a Bearer token", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      JSON.stringify({
        type: "agent_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "hi" },
        source: {
          raw: { envelope: { headers: { authorization: "Bearer abcdefABCDEF0123456789xyzXYZ" } } },
        },
      }),
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      line: 2,
      path: "/source/raw/envelope/headers/authorization",
      severity: "warning",
      code: "source_raw_unredacted_secret",
    }),
  );
});

test("walks deeply-nested source.raw without stack overflow (regression for #105)", () => {
  // walkStringLeaves used to recurse; deep nesting could blow the call stack.
  // Build the JS object directly so the walker — not JSON.parse/stringify —
  // is what's being exercised, then call sourceRawSecretDiagnostics straight.
  const depth = 100_000;
  type Nested = { next: Nested } | { token: string };
  let raw: Nested = { token: "Bearer abcdefABCDEF0123456789xyzXYZ" };
  for (let i = 0; i < depth; i += 1) {
    raw = { next: raw };
  }

  const record: JsonlRecord = {
    line: 2,
    raw: "",
    value: {
      type: "agent_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:01.000Z",
      payload: { text: "hi" },
      source: { raw },
    },
  };

  const diagnostics = sourceRawSecretDiagnostics(record);

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toEqual(
    expect.objectContaining({
      line: 2,
      path: `/source/raw${"/next".repeat(depth)}/token`,
      severity: "warning",
      code: "source_raw_unredacted_secret",
    }),
  );
});

test("stays silent when source.raw secret is already replaced by a placeholder", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      JSON.stringify({
        type: "agent_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "hi" },
        source: { raw: { envelope: { headers: { authorization: "Bearer [TOKEN]" } } } },
      }),
    ].join("\n"),
  );

  expect(diagnostics.some((d) => d.code === "source_raw_unredacted_secret")).toBe(false);
});

test("stays silent on source.raw under the soft cap", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      JSON.stringify({
        type: "agent_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:01.000Z",
        payload: { text: "hi" },
        source: { raw: { envelope: { body: "small" } } },
      }),
    ].join("\n"),
  );

  expect(diagnostics.some((d) => d.code === "source_raw_oversized")).toBe(false);
});

test("emits vcs_remote_url_with_credentials warning when remote_url contains user:pass@", async () => {
  const diagnostics = await validateTrailString(
    [
      JSON.stringify({
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000001",
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex-cli" },
        vcs: {
          type: "git",
          revision: "a1b2c3d4",
          remote_url: "https://alice:s3cret@github.com/org/repo",
        },
      }),
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      line: 1,
      path: "/vcs/remote_url",
      severity: "warning",
      code: "vcs_remote_url_with_credentials",
    }),
  );
});

test("escalates vcs_remote_url_with_credentials to error for url-encoded credentials", async () => {
  const diagnostics = await validateTrailString(
    [
      JSON.stringify({
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000001",
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex-cli" },
        vcs: {
          type: "git",
          revision: "a1b2c3d4",
          remote_url: "https://alice:s%40cret@github.com/org/repo",
        },
      }),
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      line: 1,
      path: "/vcs/remote_url",
      severity: "error",
      code: "vcs_remote_url_with_credentials",
    }),
  );
});

test("stays silent when remote_url is clean", async () => {
  const diagnostics = await validateTrailString(
    [
      JSON.stringify({
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000001",
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex-cli" },
        vcs: {
          type: "git",
          revision: "a1b2c3d4",
          remote_url: "https://github.com/org/repo",
        },
      }),
    ].join("\n"),
  );

  expect(diagnostics.some((d) => d.code === "vcs_remote_url_with_credentials")).toBe(false);
});

test("rejects a trail envelope missing the required producer field", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000001","ts":"2026-05-17T14:00:00.000Z"}',
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/producer",
    severity: "error",
    code: "required",
    message: "must have required property 'producer'",
  });
});

test("rejects a trail envelope appearing after line 1", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000001","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0"}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/type",
    severity: "error",
    code: "envelope_not_at_line_1",
    message: "Trail envelope MUST appear at line 1; found at a later line",
  });
});

test("rejects multiple trail envelopes in the same file", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000001","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0"}',
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000002","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0"}',
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/type",
    severity: "error",
    code: "multiple_envelopes",
    message: "Trail envelope MUST appear at most once per file",
  });
});

test("rejects a trail envelope at line 1 not followed by a session header", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000001","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0"}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "",
    severity: "error",
    code: "missing_header_after_envelope",
    message:
      'Trail envelope at line 1 MUST be followed by a session header on line 2 with type "session" and schema_version "0.1.0"',
  });
});

test("rejects envelope and session sharing the same id", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"trail","schema_version":"0.1.0","id":"01HEVTDUP10000000000000000","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0"}',
      '{"type":"session","schema_version":"0.1.0","id":"01HEVTDUP10000000000000000","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/id",
    severity: "error",
    code: "duplicate_id",
    message: 'Duplicate id "01HEVTDUP10000000000000000"; first seen on line 1',
  });
});

test("warns when envelope.sessions manifest disagrees with the session header", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000001","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0","sessions":[{"id":"WRONG","agent":"claude-code"}]}',
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    ].join("\n"),
  );

  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/sessions/0/id",
    severity: "warning",
    code: "envelope_sessions_manifest_drift",
    message:
      'envelope.sessions[0].id "WRONG" does not match session header id "01HSESS0000000000000000001"',
  });
  expect(diagnostics).toContainEqual({
    line: 1,
    path: "/sessions/0/agent",
    severity: "warning",
    code: "envelope_sessions_manifest_drift",
    message:
      'envelope.sessions[0].agent "claude-code" does not match session header agent.name "codex-cli"',
  });
});

test("accepts envelope.sessions manifest that matches the session header", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000001","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0","sessions":[{"id":"01HSESS0000000000000000001","agent":"codex-cli"}]}',
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("accepts envelope and session meta blocks", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000001","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0","meta":{"x-acme/team":"platform","io.entire.checkpoint_id":"ckpt-7"}}',
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"},"meta":{"com.example.ticket":"OAUTH-42"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("accepts a trail envelope at line 1 followed by a session header", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"trail","schema_version":"0.1.0","id":"01HTRACE000000000000000001","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0","name":"OAuth refactor"}',
      '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

async function collect<T>(input: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];

  for await (const value of input) {
    values.push(value);
  }

  return values;
}

async function* chunks(values: Iterable<string>): AsyncGenerator<string> {
  yield* values;
}

function schemaImplementedEventRefs(): string[] {
  const entry = (schema as SchemaValue).$defs.entry;
  const eventBranch = entry.allOf.find((branch) => "oneOf" in branch);
  if (eventBranch === undefined || !("oneOf" in eventBranch)) {
    throw new Error("Schema entry is missing event oneOf refs");
  }

  return eventBranch.oneOf
    .map((branch) => branch.$ref.split("/").at(-1))
    .filter((eventType): eventType is string => eventType !== undefined && eventType !== "unknown");
}

type SchemaValue = {
  $defs: {
    entry: {
      allOf: Array<
        | { $ref: string }
        | {
            oneOf: Array<{ $ref: string }>;
          }
      >;
    };
  };
};
