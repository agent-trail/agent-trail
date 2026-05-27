import type { ErrorObject } from "ajv";
import {
  getEventValidator,
  implementedEventTypeSet,
  validateEntryBase,
  validateWriterStrictRecord,
} from "./ajv-validation.ts";
import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";
import type { ValidationProfile } from "./profile.ts";

/**
 * Reader-tolerance policy layer. Owns the strict-vs-reader-tolerant branching:
 * patch-version upconversion (`0.1.x` for `x > 0`), unknown-payload-field
 * downgrading (additionalProperties errors → warnings), unknown-record-type
 * warnings (events that don't appear in `implementedEventTypes` but satisfy
 * `entryBase`).
 *
 * `baseDiagnosticsForProfile` is the orchestrator: it runs the schema layer
 * (`validateWriterStrictRecord`) and then applies the tolerance policy on
 * top of the resulting diagnostics.
 */

const readerCompatiblePatchVersionPattern = /^0\.1\.\d+$/;
const readerTolerantHeaderAllowedErrorPaths = new Set(["/schema_version"]);

export function baseDiagnosticsForProfile(
  record: JsonlRecord,
  profile: ValidationProfile,
): Diagnostic[] {
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
    return diagnostics;
  }

  if (hasOnlyReaderTolerantPayloadFieldAdditions(record, tolerantWarnings)) {
    return tolerantWarnings;
  }

  return diagnostics
    .filter((diagnostic) => !isDowngradedByReaderTolerance(diagnostic, tolerantWarnings))
    .concat(tolerantWarnings);
}

function readerTolerantWarningsForRecord(record: JsonlRecord): Diagnostic[] {
  const eventType = record.value.type;
  if (isHeaderLikeRecord(record) || typeof eventType !== "string") {
    return [];
  }

  const validateEvent = getEventValidator(eventType);
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
    isHeaderLikeRecord(record) ||
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
    isHeaderLikeRecord(record) ||
    typeof eventType !== "string" ||
    tolerantWarnings.length === 0 ||
    !validateEntryBase(record.value)
  ) {
    return false;
  }

  const validateEvent = getEventValidator(eventType);
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

function isHeaderLikeRecord(record: JsonlRecord): boolean {
  const recordType = record.value?.type;
  return recordType === "trail" || recordType === "session";
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
