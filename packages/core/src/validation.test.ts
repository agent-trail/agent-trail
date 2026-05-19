import { expect, test } from "bun:test";
import {
  validateWriterStrictRecord,
  validateWriterStrictSchemaJsonlStream,
  validateWriterStrictSchemaJsonlString,
} from "./index.ts";

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
