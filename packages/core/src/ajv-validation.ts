import schema from "@agent-trail/schema" with { type: "json" };
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { appendJsonPointerSegment, hasStringParam } from "./validation-utils.ts";

/**
 * AJV schema-validation layer. Owns the singleton AJV instance, the compiled
 * validators for envelope/header/entry/entryBase and each implemented event
 * type, and the schema-error → Diagnostic mapping.
 *
 * Public surface: `validateWriterStrictRecord` and `implementedEventTypes`.
 * The remaining exports (`implementedEventTypeSet`, `validateEntryBase`,
 * `getEventValidator`) exist so `reader-tolerance.ts` can run event-type
 * validators when applying profile downgrades; they are not part of
 * `@agent-trail/core`'s public surface.
 */

const schemaId = schemaIdFrom(schema);

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(schema);

const validateTrailEnvelope = compileSchemaRef(`${schemaId}#/$defs/trailEnvelope`);
const validateHeader = compileSchemaRef(`${schemaId}#/$defs/header`);
const validateEntry = compileSchemaRef(`${schemaId}#/$defs/entry`);

export const validateEntryBase = compileSchemaRef(`${schemaId}#/$defs/entryBase`);

export const implementedEventTypes = [
  "user_message",
  "agent_message",
  "tool_call",
  "tool_result",
  "session_summary",
  "system_event",
  "agent_thinking",
  "user_interrupt",
  "context_compact",
  "branch_point",
  "branch_summary",
  "model_change",
  "session_terminated",
  // Optional clean-conclusion marker (spec §9.3). Distinct from session_terminated:
  // session_end signals a normal finish, session_terminated an abnormal one.
  "session_end",
] as const;

const eventValidators = new Map<string, ValidateFunction<unknown>>(
  implementedEventTypes.map((eventType) => [
    eventType,
    compileSchemaRef(`${schemaId}#/$defs/events/${eventType}`),
  ]),
);

export const implementedEventTypeSet: ReadonlySet<string> = new Set<string>(implementedEventTypes);

export function getEventValidator(eventType: string): ValidateFunction<unknown> | undefined {
  return eventValidators.get(eventType);
}

export function validateWriterStrictRecord(record: JsonlRecord): Diagnostic[] {
  const validate = pickRecordValidator(record);
  if (validate(record.value)) {
    return [];
  }
  return (validate.errors as ErrorObject[]).map((error) =>
    diagnosticFromSchemaError(error, record.line),
  );
}

function pickRecordValidator(record: JsonlRecord): ValidateFunction<unknown> {
  const recordType = record.value.type;
  if (recordType === "trail") {
    return validateTrailEnvelope;
  }
  if (recordType === "session") {
    return validateHeader;
  }
  // Line-1 fallback: only reached when `type` is missing or unknown. Validating
  // as a session header surfaces the missing-type error inside header rules
  // rather than the more confusing event-record rules. New header-like record
  // types should be dispatched explicitly above this fallback.
  if (record.line === 1) {
    return validateHeader;
  }
  return validateEntry;
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
