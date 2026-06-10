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
import {
  appendJsonPointerSegment,
  hasStringParam,
  isHeaderLikeRecord,
} from "./validation-utils.ts";

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
  const diagnostics =
    profile === "reader-tolerant"
      ? validateWriterStrictRecord(record).map(downgradeIllFormedString)
      : validateWriterStrictRecord(record);
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
    hasOnlyReaderTolerantHeaderErrors(withoutIllFormedStrings(diagnostics))
  ) {
    return preservedNonSchemaDiagnostics(diagnostics);
  }

  if (unknownRecordWarning !== undefined) {
    return [unknownRecordWarning, ...preservedNonSchemaDiagnostics(diagnostics)];
  }

  if (tolerantWarnings.length === 0) {
    return diagnostics;
  }

  if (hasOnlyReaderTolerantPayloadFieldAdditions(record, tolerantWarnings)) {
    return preservedNonSchemaDiagnostics(diagnostics).concat(tolerantWarnings);
  }

  return diagnostics
    .filter((diagnostic) => !isDowngradedByReaderTolerance(diagnostic, tolerantWarnings))
    .concat(tolerantWarnings);
}

function downgradeIllFormedString(diagnostic: Diagnostic): Diagnostic {
  if (diagnostic.code !== "ill_formed_string") return diagnostic;
  return { ...diagnostic, severity: "warning" };
}

function withoutIllFormedStrings(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.code !== "ill_formed_string");
}

function preservedNonSchemaDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.code === "ill_formed_string" || diagnostic.code === "invalid_timestamp",
  );
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

  return dedupeDiagnostics(
    (validateEvent.errors as ErrorObject[])
      .filter(isPayloadAdditionalPropertyError)
      .map((error) => {
        const field = error.params.additionalProperty;
        return createDiagnostic({
          line: record.line,
          path: appendJsonPointerSegment(error.instancePath, field),
          severity: "warning",
          code: "reader_tolerant_unknown_payload_field",
          message: `Unknown payload field "${field}" preserved for reader-tolerant parsing`,
        });
      }),
  );
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

  const stripped = stripReaderTolerantPayloadFields(record.value, tolerantWarnings);
  return validateEvent(stripped);
}

function dedupeDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.line}\0${diagnostic.path}\0${diagnostic.code}\0${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripReaderTolerantPayloadFields(
  value: Record<string, unknown>,
  tolerantWarnings: Diagnostic[],
): Record<string, unknown> {
  const stripped = structuredClone(value);
  for (const warning of tolerantWarnings) {
    deleteJsonPointer(stripped, warning.path);
  }
  return stripped;
}

function deleteJsonPointer(value: unknown, pointer: string): void {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  const property = segments.pop();
  if (property === undefined) return;
  let target: unknown = value;
  for (const segment of segments) {
    if (Array.isArray(target)) {
      const index = Number(segment);
      target = Number.isInteger(index) ? target[index] : undefined;
    } else if (typeof target === "object" && target !== null) {
      target = (target as Record<string, unknown>)[segment];
    } else {
      return;
    }
  }
  if (typeof target === "object" && target !== null && !Array.isArray(target)) {
    delete (target as Record<string, unknown>)[property];
  }
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
