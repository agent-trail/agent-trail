import schema from "@agent-trail/schema" with { type: "json" };
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { createDiagnostic, type Diagnostic, diagnosticFromJsonlParseError } from "./diagnostics.ts";
import { validateTrailGraph } from "./graph.ts";
import { type JsonlChunk, JsonlParseError, type JsonlRecord, parseJsonlStream } from "./jsonl.ts";

const schemaId = schemaIdFrom(schema);

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);

const validateHeader = compileSchemaRef(`${schemaId}#/$defs/header`);
const validateEntry = compileSchemaRef(`${schemaId}#/$defs/entry`);

export function validateWriterStrictRecord(record: JsonlRecord): Diagnostic[] {
  const validate = record.line === 1 ? validateHeader : validateEntry;

  if (validate(record.value)) {
    return [];
  }

  return (validate.errors ?? []).map((error) => diagnosticFromSchemaError(error, record.line));
}

export async function* validateWriterStrictSchemaJsonlStream(
  input: AsyncIterable<JsonlChunk>,
): AsyncGenerator<Diagnostic> {
  try {
    for await (const record of parseJsonlStream(input)) {
      yield* validateWriterStrictRecord(record);
    }
  } catch (error) {
    if (error instanceof JsonlParseError) {
      yield diagnosticFromJsonlParseError(error);
      return;
    }

    throw error;
  }
}

export async function validateWriterStrictSchemaJsonlString(text: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for await (const diagnostic of validateWriterStrictSchemaJsonlStream(asyncIterableFrom([text]))) {
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

export async function* validateTrailStream(
  input: AsyncIterable<JsonlChunk>,
): AsyncGenerator<Diagnostic> {
  const records: JsonlRecord[] = [];

  try {
    for await (const record of parseJsonlStream(input)) {
      records.push(record);
      yield* validateWriterStrictRecord(record);
    }
  } catch (error) {
    if (error instanceof JsonlParseError) {
      yield diagnosticFromJsonlParseError(error);
    } else {
      throw error;
    }
  }

  yield* validateTrailGraph(records);
}

export async function validateTrailString(text: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  for await (const diagnostic of validateTrailStream(asyncIterableFrom([text]))) {
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

function compileSchemaRef(ref: string): ValidateFunction<unknown> {
  return ajv.compile({ $ref: ref });
}

function schemaIdFrom(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "$id" in value &&
    typeof value.$id === "string"
  ) {
    return value.$id;
  }

  throw new Error("Agent Trail schema is missing a string $id");
}

function diagnosticFromSchemaError(error: ErrorObject, line: number): Diagnostic {
  return createDiagnostic({
    line,
    path: jsonPointerPathForError(error),
    severity: "error",
    code: error.keyword,
    message: error.message ?? "Schema validation failed",
  });
}

function jsonPointerPathForError(error: ErrorObject): string {
  if (error.keyword === "required" && hasStringParam(error.params, "missingProperty")) {
    return appendJsonPointerSegment(error.instancePath, error.params.missingProperty);
  }

  if (
    error.keyword === "additionalProperties" &&
    hasStringParam(error.params, "additionalProperty")
  ) {
    return appendJsonPointerSegment(error.instancePath, error.params.additionalProperty);
  }

  return error.instancePath;
}

function appendJsonPointerSegment(path: string, segment: string): string {
  return `${path}/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function hasStringParam<T extends string>(
  params: ErrorObject["params"],
  key: T,
): params is ErrorObject["params"] & Record<T, string> {
  return key in params && typeof params[key] === "string";
}

async function* asyncIterableFrom<T>(values: Iterable<T>): AsyncGenerator<T> {
  yield* values;
}
