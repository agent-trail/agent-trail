export type JsonlChunk = string | Uint8Array;

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
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let line = 1;

  try {
    for await (const chunk of input) {
      pending += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });

      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        const raw = pending.slice(0, newlineIndex);
        yield parseLine(stripTrailingCarriageReturn(raw), line);
        pending = pending.slice(newlineIndex + 1);
        line += 1;
        newlineIndex = pending.indexOf("\n");
      }
    }

    const flushed = decoder.decode();
    if (flushed.length > 0) {
      pending += flushed;
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new JsonlParseError("invalid_utf8", line, `Invalid UTF-8 on line ${line}`, pending);
    }

    throw error;
  }

  if (pending.length > 0) {
    yield parseLine(stripTrailingCarriageReturn(pending), line);
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

function stripTrailingCarriageReturn(raw: string): string {
  return raw.endsWith("\r") ? raw.slice(0, -1) : raw;
}

async function* asyncIterableFrom<T>(values: Iterable<T>): AsyncGenerator<T> {
  yield* values;
}
