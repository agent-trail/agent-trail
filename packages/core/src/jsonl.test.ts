import { expect, test } from "bun:test";
import { JsonlParseError, parseJsonlStream, parseJsonlString } from "@agent-trail/core";

test("parses one-line JSONL", async () => {
  const records = await parseJsonlString('{"type":"session"}');

  expect(records).toEqual([
    {
      line: 1,
      raw: '{"type":"session"}',
      value: { type: "session" },
    },
  ]);
});

test("parses multi-line JSONL", async () => {
  const records = await parseJsonlString('{"type":"session"}\n{"type":"user_message"}');

  expect(records.map((record) => record.line)).toEqual([1, 2]);
  expect(records.map((record) => record.value)).toEqual([
    { type: "session" },
    { type: "user_message" },
  ]);
});

test("parses chunks split inside JSON and between lines", async () => {
  const records = await collect(
    parseJsonlStream(chunks(['{"ty', 'pe":"session"}\n{"type"', ':"agent_message"}'])),
  );

  expect(records.map((record) => record.value)).toEqual([
    { type: "session" },
    { type: "agent_message" },
  ]);
});

test("parses Uint8Array chunks with UTF-8 streaming decode", async () => {
  const bytes = new TextEncoder().encode('{"text":"hi 😀"}\n{"text":"bye"}');
  const records = await collect(parseJsonlStream(chunks([bytes.slice(0, 13), bytes.slice(13)])));

  expect(records.map((record) => record.value)).toEqual([{ text: "hi 😀" }, { text: "bye" }]);
});

test("tolerates CRLF input", async () => {
  const records = await parseJsonlString('{"type":"session"}\r\n{"type":"agent_message"}\r\n');

  expect(records.map((record) => record.raw)).toEqual([
    '{"type":"session"}',
    '{"type":"agent_message"}',
  ]);
});

test("allows trailing newline", async () => {
  const records = await parseJsonlString('{"type":"session"}\n');

  expect(records).toHaveLength(1);
});

test("empty input returns no records", async () => {
  await expect(parseJsonlString("")).resolves.toEqual([]);
});

test("malformed JSON reports the failing line", async () => {
  await expectJsonlError('{"ok":true}\n{"bad":', {
    code: "invalid_json",
    line: 2,
    raw: '{"bad":',
  });
});

test("empty middle line reports the failing line", async () => {
  await expectJsonlError('{"ok":true}\n\n{"ok":false}', {
    code: "empty_line",
    line: 2,
    raw: "",
  });
});

test("whitespace-only line reports the failing line", async () => {
  await expectJsonlError('{"ok":true}\n   \n{"ok":false}', {
    code: "empty_line",
    line: 2,
    raw: "   ",
  });
});

test("top-level array reports object-structure failure", async () => {
  await expectJsonlError("[]", { code: "non_object", line: 1, raw: "[]" });
});

test("top-level null reports object-structure failure", async () => {
  await expectJsonlError("null", { code: "non_object", line: 1, raw: "null" });
});

test("top-level string reports object-structure failure", async () => {
  await expectJsonlError('"hello"', { code: "non_object", line: 1, raw: '"hello"' });
});

test("invalid UTF-8 reports a parse error", async () => {
  const invalid = new Uint8Array([0xc3, 0x28]);

  await expectJsonlError(chunks([invalid]), {
    code: "invalid_utf8",
    line: 1,
    raw: "",
  });
});

async function expectJsonlError(
  input: string | AsyncIterable<string | Uint8Array>,
  expected: { code: string; line: number; raw: string },
) {
  try {
    if (typeof input === "string") {
      await parseJsonlString(input);
    } else {
      await collect(parseJsonlStream(input));
    }
  } catch (error) {
    expect(error).toBeInstanceOf(JsonlParseError);
    expect(error).toMatchObject(expected);
    return;
  }

  throw new Error("Expected JsonlParseError");
}

async function collect<T>(input: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];

  for await (const value of input) {
    values.push(value);
  }

  return values;
}

async function* chunks(values: Iterable<string | Uint8Array>): AsyncGenerator<string | Uint8Array> {
  yield* values;
}
