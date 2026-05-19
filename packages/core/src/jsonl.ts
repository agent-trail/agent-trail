export type JsonlChunk = string | Uint8Array<ArrayBufferLike>;

export type JsonlParseErrorCode = "empty_line" | "invalid_json" | "invalid_utf8" | "non_object";

export type JsonlRecord = {
  line: number;
  raw: string;
  value: Record<string, unknown>;
};

export class JsonlParseError extends Error {
  readonly code: JsonlParseErrorCode;
  readonly line: number;
  readonly raw: string;

  constructor(code: JsonlParseErrorCode, line: number, message: string, raw = "") {
    super(message);
    this.name = "JsonlParseError";
    this.code = code;
    this.line = line;
    this.raw = raw;
  }
}

export async function* parseJsonlStream(
  input: AsyncIterable<JsonlChunk>,
): AsyncGenerator<JsonlRecord> {
  const encoder = new TextEncoder();
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let line = 1;

  for await (const chunk of input) {
    pending = appendBytes(pending, typeof chunk === "string" ? encoder.encode(chunk) : chunk);

    let newlineIndex = pending.indexOf(0x0a);
    while (newlineIndex !== -1) {
      const raw = decodeLine(
        stripTrailingCarriageReturnByte(pending.subarray(0, newlineIndex)),
        line,
      );
      yield parseLine(raw, line);
      pending = pending.subarray(newlineIndex + 1);
      line += 1;
      newlineIndex = pending.indexOf(0x0a);
    }
  }

  if (pending.byteLength > 0) {
    const raw = decodeLine(stripTrailingCarriageReturnByte(pending), line);
    yield parseLine(raw, line);
  }
}

export async function parseJsonlString(text: string): Promise<JsonlRecord[]> {
  const records: JsonlRecord[] = [];

  for await (const record of parseJsonlStream(asyncIterableFrom([text]))) {
    records.push(record);
  }

  return records;
}

function parseLine(raw: string, line: number): JsonlRecord {
  if (raw.trim().length === 0) {
    throw new JsonlParseError("empty_line", line, `Empty JSONL line at line ${line}`, raw);
  }

  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    throw new JsonlParseError("invalid_json", line, `Invalid JSON on line ${line}`, raw);
  }

  if (!isJsonObject(value)) {
    throw new JsonlParseError("non_object", line, `Expected a JSON object on line ${line}`, raw);
  }

  return { line, raw, value };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  if (left.byteLength === 0) {
    return right;
  }

  if (right.byteLength === 0) {
    return left;
  }

  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left, 0);
  combined.set(right, left.byteLength);
  return combined;
}

function decodeLine(bytes: Uint8Array<ArrayBufferLike>, line: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new JsonlParseError("invalid_utf8", line, `Invalid UTF-8 on line ${line}`);
    }

    throw error;
  }
}

function stripTrailingCarriageReturnByte(
  bytes: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  return bytes.at(-1) === 0x0d ? bytes.subarray(0, -1) : bytes;
}

async function* asyncIterableFrom<T>(values: Iterable<T>): AsyncGenerator<T> {
  yield* values;
}
