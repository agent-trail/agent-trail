import { expect, test } from "bun:test";
import schema from "@agent-trail/schema" with { type: "json" };
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
    raw: '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    value: {
      type: "session",
      schema_version: "0.1.0",
      id: "sess1",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("accepts a minimal writer-strict event after the header line", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 2,
    raw: '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
    value: {
      type: "user_message",
      id: "evta1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    },
  });

  expect(diagnostics).toEqual([]);
});

test("rejects a writer-strict header with the wrong schema version", () => {
  const diagnostics = validateWriterStrictRecord({
    line: 1,
    raw: '{"type":"session","schema_version":"0.2.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    value: {
      type: "session",
      schema_version: "0.2.0",
      id: "sess1",
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
    raw: '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{}}',
    value: {
      type: "user_message",
      id: "evta1",
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
      '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"agent_message","id":"evta2","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("converts JSONL parse failures into writer-strict diagnostics", async () => {
  const diagnostics = await validateWriterStrictSchemaJsonlString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
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
    '{"type":"session","schema_version":"0.2.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
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
        '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}\n',
        '{"type":"tool_call","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"tool":"file_read","args":{}}}',
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
      '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"agent_message","id":"evta2","parent_id":"evta1","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}',
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
    '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello","future_field":true}}',
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
    '{"type":"session","schema_version":"0.1.1","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
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
    '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello","future_field":true}}',
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
    '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello","attachments":[{"kind":"file","future_field":true}]}}',
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
      '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":42}}',
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
    '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"future_event","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"future":true}}',
  ].join("\n");

  const records = await parseJsonlString(text);
  expect(records[1]).toEqual({
    line: 2,
    raw: '{"type":"future_event","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"future":true}}',
    value: {
      type: "future_event",
      id: "evta1",
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
    '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
    '{"type":"error","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"future":true}}',
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
      '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"agent_message","id":"evta1","ts":"not-a-timestamp","payload":{"text":"hi"}}',
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
    message: 'Duplicate id "evta1"; first seen on line 2',
  });
});

test("validateTrailStream emits graph diagnostics after schema diagnostics", async () => {
  const diagnostics = await collect(
    validateTrailStream(
      chunks([
        '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}\n',
        '{"type":"agent_message","id":"node-a","parent_id":"node-b","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"a"}}\n',
        '{"type":"agent_message","id":"node-b","parent_id":"node-a","ts":"2026-05-17T14:00:06.000Z","payload":{"text":"b"}}',
      ]),
    ),
  );

  expect(diagnostics.map((d) => d.code)).toEqual(["parent_cycle", "parent_cycle"]);
  expect(diagnostics.map((d) => d.line)).toEqual([2, 3]);
});

test("validateTrailString surfaces JSONL parse errors and still runs graph checks on prior records", async () => {
  const diagnostics = await validateTrailString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"agent_message","id":"evta1","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}',
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
    message: 'Duplicate id "evta1"; first seen on line 2',
  });
});

test("leaves whole-file graph checks to later validation layers", async () => {
  const diagnostics = await validateWriterStrictSchemaJsonlString(
    [
      '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
      '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}',
      '{"type":"agent_message","id":"evta1","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}',
    ].join("\n"),
  );

  expect(diagnostics).toEqual([]);
});

test("does not emit content_hash_mismatch when a parse error truncates the records", async () => {
  const headerValue: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: "sess1",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  };
  const userValue: Record<string, unknown> = {
    type: "user_message",
    id: "evta1",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hello" },
  };
  const agentValue: Record<string, unknown> = {
    type: "agent_message",
    id: "evta2",
    ts: "2026-05-17T14:00:07.000Z",
    payload: { text: "hi" },
  };
  const droppedValue: Record<string, unknown> = {
    type: "user_message",
    id: "evta3",
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
