import schema from "@agent-trail/schema" with { type: "json" };
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { createDiagnostic, type Diagnostic, diagnosticFromJsonlParseError } from "./diagnostics.ts";
import { validateTrailGraph } from "./graph.ts";
import { type JsonlChunk, JsonlParseError, type JsonlRecord, parseJsonlStream } from "./jsonl.ts";
import { resolveValidationProfile, type ValidationProfile } from "./profile.ts";
import { CREDENTIAL_PATTERNS, type RedactionPattern } from "./secret-patterns.ts";
import { SOURCE_RAW_HARD_CAP_BYTES, SOURCE_RAW_SOFT_CAP_BYTES } from "./source-raw.ts";

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

// userinfo with explicit password (user:pass@host). Url-encoded passwords
// stay caught because ":" remains literal.
const VCS_REMOTE_URL_CREDENTIALS_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]*:([^/@\s]+)@/i;
const URL_ENCODED_OCTET_PATTERN = /%[0-9A-Fa-f]{2}/;

function vcsRemoteUrlDiagnostics(record: JsonlRecord): Diagnostic[] {
  if (record.line !== 1) {
    return [];
  }
  const vcs = (record.value as { vcs?: unknown }).vcs;
  if (typeof vcs !== "object" || vcs === null) {
    return [];
  }
  const remoteUrl = (vcs as { remote_url?: unknown }).remote_url;
  if (typeof remoteUrl !== "string") {
    return [];
  }
  const match = VCS_REMOTE_URL_CREDENTIALS_PATTERN.exec(remoteUrl);
  if (match === null) {
    return [];
  }
  const password = match[1] ?? "";
  const severity = URL_ENCODED_OCTET_PATTERN.test(password) ? "error" : "warning";
  return [
    createDiagnostic({
      line: record.line,
      path: "/vcs/remote_url",
      severity,
      code: "vcs_remote_url_with_credentials",
      message: `vcs.remote_url contains embedded credentials; strip user:pass before emission${
        severity === "error" ? " (url-encoded password detected)" : ""
      }`,
    }),
  ];
}

function baseDiagnosticsForProfile(record: JsonlRecord, profile: ValidationProfile): Diagnostic[] {
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

function sourceRawSizeDiagnostics(record: JsonlRecord): Diagnostic[] {
  if (record.line === 1) {
    return [];
  }
  const source = record.value.source;
  if (typeof source !== "object" || source === null) {
    return [];
  }
  const raw = (source as { raw?: unknown }).raw;
  if (raw === undefined) {
    return [];
  }
  const bytes = Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8");
  if (bytes > SOURCE_RAW_HARD_CAP_BYTES) {
    return [
      createDiagnostic({
        line: record.line,
        path: "/source/raw",
        severity: "error",
        code: "source_raw_oversized_hard",
        message: `source.raw is ${bytes} bytes, exceeds hard cap of ${SOURCE_RAW_HARD_CAP_BYTES} bytes; adapter should elide to { elided: true, size_bytes: N }`,
      }),
    ];
  }
  if (bytes > SOURCE_RAW_SOFT_CAP_BYTES) {
    return [
      createDiagnostic({
        line: record.line,
        path: "/source/raw",
        severity: "warning",
        code: "source_raw_oversized",
        message: `source.raw is ${bytes} bytes, exceeds soft cap of ${SOURCE_RAW_SOFT_CAP_BYTES} bytes`,
      }),
    ];
  }
  return [];
}

// Walks source.raw and emits one warning per (leaf, matching pattern) pair.
// Granularity is per-leaf, not per-match: a single string leaf containing two
// instances of the same pattern produces one warning, not two. Per-instance
// counts are out of scope for validator diagnostics; share-time redaction
// (see @agent-trail/redact) records per-match counts in its summary.
function sourceRawSecretDiagnostics(record: JsonlRecord): Diagnostic[] {
  if (record.line === 1) {
    return [];
  }
  const source = record.value.source;
  if (typeof source !== "object" || source === null) {
    return [];
  }
  const raw = (source as { raw?: unknown }).raw;
  if (raw === undefined) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];
  walkStringLeaves(raw, "/source/raw", (text, path) => {
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (matchesPattern(text, pattern)) {
        diagnostics.push(
          createDiagnostic({
            line: record.line,
            path,
            severity: "warning",
            code: "source_raw_unredacted_secret",
            message: `source.raw contains unredacted ${pattern.description} (${pattern.id})`,
          }),
        );
      }
    }
  });
  return diagnostics;
}

function matchesPattern(text: string, pattern: RedactionPattern): boolean {
  const regex = pattern.regex.flags.includes("g")
    ? new RegExp(pattern.regex.source, pattern.regex.flags)
    : new RegExp(pattern.regex.source, `${pattern.regex.flags}g`);
  regex.lastIndex = 0;
  return regex.test(text);
}

function walkStringLeaves(
  value: unknown,
  path: string,
  visit: (text: string, path: string) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkStringLeaves(value[i], `${path}/${i}`, visit);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      walkStringLeaves(
        (value as Record<string, unknown>)[key],
        `${path}/${escapeJsonPointerSegment(key)}`,
        visit,
      );
    }
  }
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
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
