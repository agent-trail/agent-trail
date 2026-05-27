import { validateWriterStrictRecord } from "./ajv-validation.ts";
import {
  sourceRawSecretDiagnostics,
  sourceRawSizeDiagnostics,
  vcsRemoteUrlDiagnostics,
} from "./business-rules.ts";
import { type Diagnostic, diagnosticFromJsonlParseError } from "./diagnostics.ts";
import { validateTrailGraph } from "./graph.ts";
import { type JsonlChunk, JsonlParseError, type JsonlRecord, parseJsonlStream } from "./jsonl.ts";
import { resolveValidationProfile, type ValidationProfile } from "./profile.ts";
import { baseDiagnosticsForProfile } from "./reader-tolerance.ts";

/**
 * Validation orchestrator. Composes three layers — AJV schema validation
 * (`./ajv-validation.ts`), reader-tolerance policy (`./reader-tolerance.ts`),
 * and business-rule sniffs (`./business-rules.ts`) — behind the stream/string
 * entry points consumed by the CLI, the adapter package, and the store.
 *
 * Re-exports `validateWriterStrictRecord` and `implementedEventTypes` for
 * back-compat: prior versions of this module owned both, and downstream
 * imports (`@agent-trail/core` re-exports, plus one direct test import of
 * `implementedEventTypes`) continue to resolve through `validation.ts`.
 */

export { implementedEventTypes, validateWriterStrictRecord } from "./ajv-validation.ts";

export type ValidateTrailOptions = {
  profile?: ValidationProfile;
};

function validateRecordForProfile(record: JsonlRecord, profile: ValidationProfile): Diagnostic[] {
  // source.raw size + secret diagnostics are independent of profile and never
  // overlap with the schema-derived diagnostics, so compute them once and
  // append at the end. Keeping the append in a single tail-position prevents
  // accidental double-emission when the profile branches grow.
  const sourceRawExtras = sourceRawSizeDiagnostics(record).concat(
    sourceRawSecretDiagnostics(record),
  );
  const headerExtras = vcsRemoteUrlDiagnostics(record);

  return baseDiagnosticsForProfile(record, profile).concat(sourceRawExtras).concat(headerExtras);
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

async function* asyncIterableFrom<T>(values: Iterable<T>): AsyncGenerator<T> {
  yield* values;
}
