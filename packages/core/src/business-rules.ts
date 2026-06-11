import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";
import {
  CREDENTIAL_PATTERNS,
  isCredentialKey,
  isSafeCredentialContextValue,
  type RedactionPattern,
} from "./secret-patterns.ts";
import { SOURCE_RAW_HARD_CAP_BYTES, SOURCE_RAW_SOFT_CAP_BYTES } from "./source-raw.ts";
import { isHeaderLikeRecord } from "./validation-utils.ts";

/**
 * Business-rule sniffs: per-record heuristics layered on top of schema and
 * tolerance validation. None of these are encodable in JSON Schema —
 * they require either spec-policy constants (source.raw size budget) or
 * adapter-side rules of thumb (secret patterns, credential URLs).
 *
 *   - `sourceRawSizeDiagnostics` — hard cap (32 KB) and soft cap (8 KB)
 *     warnings against the byte size of `source.raw`. Encourages adapters
 *     to elide oversized raw payloads.
 *   - `sourceRawSecretDiagnostics` — walks `source.raw` string leaves and
 *     warns on credential pattern matches (Bearer tokens, API keys, etc.).
 *   - `toolArgsSecretDiagnostics` — walks tool args and warns on the same
 *     credential pattern and credential-key matches.
 *   - `vcsRemoteUrlDiagnostics` — flags `vcs.remote_url` values containing
 *     `user:pass@` credentials; promotes to error when the password appears
 *     to be URL-encoded (writer leaked deliberately-encoded credentials).
 *   - `timestampDiagnostics` — enforces the spec §18.4 calendar-valid UTC
 *     millisecond timestamp rule that JSON Schema regex alone cannot express.
 */

// userinfo with explicit password (user:pass@host). Url-encoded passwords
// stay caught because ":" remains literal.
const VCS_REMOTE_URL_CREDENTIALS_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]*:([^/@\s]+)@/i;
const URL_ENCODED_OCTET_PATTERN = /%[0-9A-Fa-f]{2}/;

export function sourceRawSizeDiagnostics(record: JsonlRecord): Diagnostic[] {
  if (isHeaderLikeRecord(record)) {
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
  const bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
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
export function sourceRawSecretDiagnostics(record: JsonlRecord): Diagnostic[] {
  if (isHeaderLikeRecord(record)) {
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
  appendCredentialDiagnostics(
    diagnostics,
    record.line,
    raw,
    "/source/raw",
    "source_raw_unredacted_secret",
    "source.raw",
  );
  return diagnostics;
}

export function toolArgsSecretDiagnostics(record: JsonlRecord): Diagnostic[] {
  const value = record.value as Record<string, unknown>;
  if (value.type !== "tool_call") return [];
  const payload = value.payload as Record<string, unknown> | undefined;
  const args = payload?.args as Record<string, unknown> | undefined;
  if (args === undefined || args === null || typeof args !== "object") return [];

  const diagnostics: Diagnostic[] = [];
  appendCredentialDiagnostics(
    diagnostics,
    record.line,
    args,
    "/payload/args",
    "tool_args_unredacted_secret",
    "tool_call args",
  );
  return diagnostics;
}

export function vcsRemoteUrlDiagnostics(record: JsonlRecord): Diagnostic[] {
  if (!isHeaderLikeRecord(record)) {
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
  const password = match[1] as string;
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

const WRITER_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INVALID_TIMESTAMP_MESSAGE =
  "Timestamp must be a valid UTC ISO-8601 value with millisecond precision";

export function timestampDiagnostics(record: JsonlRecord): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const value = record.value as Record<string, unknown>;
  appendTimestampDiagnostic(diagnostics, record.line, "/ts", value.ts);

  if (value.type === "session") {
    const stream = value.stream;
    if (stream !== null && typeof stream === "object" && !Array.isArray(stream)) {
      appendTimestampDiagnostic(
        diagnostics,
        record.line,
        "/stream/started_at",
        (stream as Record<string, unknown>).started_at,
      );
    }
  }

  return diagnostics;
}

function appendTimestampDiagnostic(
  diagnostics: Diagnostic[],
  line: number,
  path: string,
  value: unknown,
): void {
  if (typeof value !== "string" || !WRITER_TIMESTAMP_PATTERN.test(value)) return;
  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime()) && parsed.toISOString() === value) return;
  diagnostics.push(
    createDiagnostic({
      line,
      path,
      severity: "error",
      code: "invalid_timestamp",
      message: INVALID_TIMESTAMP_MESSAGE,
    }),
  );
}

function matchesPattern(text: string, pattern: RedactionPattern): boolean {
  const regex = pattern.regex.flags.includes("g")
    ? new RegExp(pattern.regex.source, pattern.regex.flags)
    : new RegExp(pattern.regex.source, `${pattern.regex.flags}g`);
  regex.lastIndex = 0;
  return regex.test(text);
}

function appendCredentialDiagnostics(
  diagnostics: Diagnostic[],
  line: number,
  root: unknown,
  rootPath: string,
  code: "source_raw_unredacted_secret" | "tool_args_unredacted_secret",
  label: string,
): void {
  walkStringLeaves(root, rootPath, (text, path, key) => {
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (matchesPattern(text, pattern)) {
        diagnostics.push(
          createDiagnostic({
            line,
            path,
            severity: "warning",
            code,
            message: `${label} contain unredacted ${pattern.description} (${pattern.id})`,
          }),
        );
      }
    }
    if (isCredentialKey(key) && !isSafeCredentialContextValue(text)) {
      diagnostics.push(
        createDiagnostic({
          line,
          path,
          severity: "warning",
          code,
          message: `${label} contain unredacted credential-looking field (${key})`,
        }),
      );
    }
  });
}

// Iterative DFS so deeply-nested source.raw payloads cannot blow the call
// stack; the heap-allocated frame list takes the depth instead. Children are
// pushed in reverse so the first child pops next, preserving pre-order.
function walkStringLeaves(
  root: unknown,
  rootPath: string,
  visit: (text: string, path: string, key: string | undefined) => void,
): void {
  const stack: Array<{ value: unknown; path: string; key?: string }> = [
    { value: root, path: rootPath },
  ];
  while (stack.length > 0) {
    const { value, path, key } = stack.pop()!;
    if (typeof value === "string") {
      visit(value, path, key);
      continue;
    }
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i -= 1) {
        stack.push({ value: value[i], path: `${path}/${i}` });
      }
      continue;
    }
    if (value !== null && typeof value === "object") {
      const reversedKeys = Object.keys(value as Record<string, unknown>).reverse();
      for (const key of reversedKeys) {
        stack.push({
          value: (value as Record<string, unknown>)[key],
          path: `${path}/${escapeJsonPointerSegment(key)}`,
          key,
        });
      }
    }
  }
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
