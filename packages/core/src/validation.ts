import schema from "@agent-trail/schema" with { type: "json" };
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { createDiagnostic, type Diagnostic, diagnosticFromJsonlParseError } from "./diagnostics.ts";
import { validateTrailGraph } from "./graph.ts";
import { type JsonlChunk, JsonlParseError, type JsonlRecord, parseJsonlStream } from "./jsonl.ts";
import { resolveValidationProfile, type ValidationProfile } from "./profile.ts";

const schemaId = schemaIdFrom(schema);

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);

const validateHeader = compileSchemaRef(`${schemaId}#/$defs/header`);
const validateEntry = compileSchemaRef(`${schemaId}#/$defs/entry`);
const validateEntryBase = compileSchemaRef(`${schemaId}#/$defs/entryBase`);
export const implementedEventTypes = [
  "user_message",
  "agent_message",
  "tool_call",
  "tool_result",
  "session_summary",
  "agent_thinking",
  "user_interrupt",
  "context_compact",
  "branch_point",
  "branch_summary",
  "model_change",
  "session_terminated",
] as const;

const eventValidators = new Map<string, ValidateFunction<unknown>>(
  implementedEventTypes.map((eventType) => [
    eventType,
    compileSchemaRef(`${schemaId}#/$defs/events/${eventType}`),
  ]),
);

const implementedEventTypeSet = new Set<string>(implementedEventTypes);

const readerCompatiblePatchVersionPattern = /^0\.1\.\d+$/;

const readerTolerantHeaderAllowedErrorPaths = new Set(["/schema_version"]);

export type ValidateTrailOptions = {
  profile?: ValidationProfile;
};

export function validateWriterStrictRecord(record: JsonlRecord): Diagnostic[] {
  const validate = record.line === 1 ? validateHeader : validateEntry;

  if (validate(record.value)) {
    return [];
  }

  return (validate.errors ?? []).map((error) => diagnosticFromSchemaError(error, record.line));
}

function validateRecordForProfile(record: JsonlRecord, profile: ValidationProfile): Diagnostic[] {
  const diagnostics = validateWriterStrictRecord(record);
  const unknownRecordWarning =
    profile === "reader-tolerant" ? readerTolerantUnknownRecordWarning(record) : undefined;

  if (profile === "strict") {
    return diagnostics;
  }

  if (diagnostics.length === 0) {
    return unknownRecordWarning === undefined ? [] : [unknownRecordWarning];
  }

  const tolerantWarnings = readerTolerantWarningsForRecord(record);
  if (
    profile === "reader-tolerant" &&
    isReaderCompatiblePatchHeader(record) &&
    hasOnlyReaderTolerantHeaderErrors(diagnostics)
  ) {
    return [];
  }

  if (unknownRecordWarning !== undefined) {
    return [unknownRecordWarning];
  }

  if (tolerantWarnings.length === 0) {
    return unknownRecordWarning === undefined
      ? diagnostics
      : diagnostics.concat(unknownRecordWarning);
  }

  if (hasOnlyReaderTolerantPayloadFieldAdditions(record, tolerantWarnings)) {
    return tolerantWarnings;
  }

  return diagnostics
    .filter((diagnostic) => !isDowngradedByReaderTolerance(diagnostic, tolerantWarnings))
    .concat(tolerantWarnings);
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
  options: ValidateTrailOptions = {},
): AsyncGenerator<Diagnostic> {
  const profile = resolveValidationProfile(options.profile);
  const records: JsonlRecord[] = [];
  let canonicalBytesComplete = true;

  try {
    for await (const record of parseJsonlStream(input)) {
      records.push(record);
      yield* validateRecordForProfile(record, profile);
    }
  } catch (error) {
    if (error instanceof JsonlParseError) {
      canonicalBytesComplete = false;
      yield diagnosticFromJsonlParseError(error);
    } else {
      throw error;
    }
  }

  yield* validateTrailGraph(records, { canonicalBytesComplete, profile });
}

export async function validateTrailString(
  text: string,
  options: ValidateTrailOptions = {},
): Promise<Diagnostic[]> {
  const profile = resolveValidationProfile(options.profile);
  const diagnostics: Diagnostic[] = [];

  for await (const diagnostic of validateTrailStream(asyncIterableFrom([text]), { profile })) {
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

function readerTolerantWarningsForRecord(record: JsonlRecord): Diagnostic[] {
  const eventType = record.value.type;
  if (record.line === 1 || typeof eventType !== "string") {
    return [];
  }

  const validateEvent = eventValidators.get(eventType);
  if (validateEvent === undefined || validateEvent(record.value)) {
    return [];
  }

  return (validateEvent.errors ?? []).filter(isPayloadAdditionalPropertyError).map((error) => {
    const field = error.params.additionalProperty;
    return createDiagnostic({
      line: record.line,
      path: appendJsonPointerSegment(error.instancePath, field),
      severity: "warning",
      code: "reader_tolerant_unknown_payload_field",
      message: `Unknown payload field "${field}" preserved for reader-tolerant parsing`,
    });
  });
}

function readerTolerantUnknownRecordWarning(record: JsonlRecord): Diagnostic | undefined {
  const eventType = record.value.type;
  if (
    record.line === 1 ||
    typeof eventType !== "string" ||
    implementedEventTypeSet.has(eventType) ||
    !validateEntryBase(record.value)
  ) {
    return undefined;
  }

  return createDiagnostic({
    line: record.line,
    path: "/type",
    severity: "warning",
    code: "reader_tolerant_unknown_record",
    message: `Unknown event type "${eventType}" preserved for reader-tolerant parsing`,
  });
}

function hasOnlyReaderTolerantPayloadFieldAdditions(
  record: JsonlRecord,
  tolerantWarnings: Diagnostic[],
): boolean {
  const eventType = record.value.type;
  if (
    record.line === 1 ||
    typeof eventType !== "string" ||
    tolerantWarnings.length === 0 ||
    !validateEntryBase(record.value)
  ) {
    return false;
  }

  const validateEvent = eventValidators.get(eventType);
  if (validateEvent === undefined || validateEvent(record.value)) {
    return false;
  }

  return (validateEvent.errors ?? []).every(isPayloadAdditionalPropertyError);
}

function isPayloadAdditionalPropertyError(
  error: ErrorObject,
): error is ErrorObject & { params: ErrorObject["params"] & { additionalProperty: string } } {
  return (
    error.keyword === "additionalProperties" &&
    isPayloadPath(error.instancePath) &&
    hasStringParam(error.params, "additionalProperty")
  );
}

function hasOnlyReaderTolerantHeaderErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.every((diagnostic) =>
    readerTolerantHeaderAllowedErrorPaths.has(diagnostic.path),
  );
}

function isReaderCompatiblePatchHeader(record: JsonlRecord): boolean {
  return (
    record.line === 1 &&
    record.value.type === "session" &&
    typeof record.value.schema_version === "string" &&
    record.value.schema_version !== "0.1.0" &&
    readerCompatiblePatchVersionPattern.test(record.value.schema_version)
  );
}

function isPayloadPath(path: string): boolean {
  return path === "/payload" || path.startsWith("/payload/");
}

function isDowngradedByReaderTolerance(
  diagnostic: Diagnostic,
  tolerantWarnings: Diagnostic[],
): boolean {
  return (
    diagnostic.code === "additionalProperties" &&
    diagnostic.severity === "error" &&
    tolerantWarnings.some((warning) => warning.path === diagnostic.path)
  );
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
