import { createDiagnostic, type Diagnostic } from "@agent-trail/core";
import type { ErrorObject } from "ajv";
import type { RawRecord } from "../readers/types.ts";
import { getSourceValidator } from "./registry.ts";

/**
 * Validate a raw source record against a specific source-format schema version.
 * Returns `[]` when the record matches the schema. A non-empty result means the
 * record drifted from the known shape (new record type, missing required field)
 * — the caller should quarantine it rather than emit a degraded trail entry.
 *
 * An unknown `agent/version` pair yields a single diagnostic rather than
 * throwing, so a parser that selected an unrecognised version still proceeds.
 */
export function validateSourceRecord(
  agent: string,
  version: string,
  record: RawRecord,
): Diagnostic[] {
  const validate = getSourceValidator(agent, version);
  if (validate === undefined) {
    return [
      createDiagnostic({
        line: 0,
        path: "",
        severity: "error",
        code: "unknown-source-schema",
        message: `No source schema registered for ${agent}/${version}`,
      }),
    ];
  }
  if (validate(record)) {
    return [];
  }
  return (validate.errors ?? []).map(diagnosticFromSchemaError);
}

const SEMANTIC_CODES: Record<string, string> = {
  enum: "source-enum-mismatch",
  type: "source-type-mismatch",
  required: "source-missing-required-field",
  additionalProperties: "source-unexpected-field",
  const: "source-const-mismatch",
  pattern: "source-pattern-mismatch",
};

function diagnosticFromSchemaError(error: ErrorObject): Diagnostic {
  return createDiagnostic({
    line: 0,
    path: error.instancePath,
    severity: "error",
    code: SEMANTIC_CODES[error.keyword] ?? `source-${error.keyword}`,
    message: error.message ?? "Source schema validation failed",
  });
}
