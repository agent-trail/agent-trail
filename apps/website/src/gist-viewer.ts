import schema from "@agent-trail/schema";
import type { ErrorObject } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import canonicalize from "canonicalize";

export type ViewerDiagnostic = {
  line: number;
  path: string;
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type ViewerEventKind =
  | "agent"
  | "fallback"
  | "notice"
  | "summary"
  | "tool_call"
  | "tool_result"
  | "user";

export type ViewerEvent = {
  id: string | null;
  line: number;
  ts: string | null;
  type: string;
  kind: ViewerEventKind;
  title: string;
  body: string | null;
  meta: { label: string; value: string }[];
  rawJson?: string;
  status?: "error" | "ok" | "unknown";
};

export type GistViewerModel =
  | {
      title: "Trail viewer";
      status: "loaded";
      gistId: string;
      filename: string;
      sourceUrl: string;
      contentHash: string | null;
      diagnostics: ViewerDiagnostic[];
      summary: {
        records: number;
        sessions: number;
        warnings: number;
      };
      events: ViewerEvent[];
      preview: string;
      previewTruncated: boolean;
      previewBytes: number;
    }
  | {
      title: "Trail viewer";
      status: "error";
      gistId: string;
      message: string;
      diagnostics: ViewerDiagnostic[];
    };

export type GistPayload = {
  filename: string;
  payloadText: string;
  sourceUrl: string;
};

export type FetchGistPayload = (gistId: string) => Promise<GistPayload>;
export type HttpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const GIST_VIEWER_LIMITS = {
  fetchTimeoutMs: 10_000,
  maxMetadataChars: 512_000,
  maxMetadataFiles: 100,
  maxBase64Chars: 2_100_000,
  maxCompressedBytes: 1_500_000,
  maxDecodedBytes: 8_000_000,
  maxPreviewBytes: 65_536,
} as const;

const GIST_ID_RE = /^[0-9a-f]{20,32}$/;
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

type TrailRecord = {
  line: number;
  value: Record<string, unknown>;
};

type SessionGroup = {
  header: TrailRecord;
  entries: TrailRecord[];
  records: TrailRecord[];
};

class JsonlParseError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`line ${line}: ${message}`);
    this.name = "JsonlParseError";
  }
}

export async function buildGistViewerModel({
  gistId,
  fetchGistPayload = fetchGistPayloadFromGitHub,
}: {
  gistId: string;
  fetchGistPayload?: FetchGistPayload;
}): Promise<GistViewerModel> {
  if (!GIST_ID_RE.test(gistId)) {
    return viewerError(gistId, "Unsupported gist id: expected 20-32 lowercase hex characters.");
  }

  let fetched: GistPayload;
  try {
    fetched = await fetchGistPayload(gistId);
  } catch (error) {
    return viewerError(gistId, `Failed to fetch gist payload: ${errorMessage(error)}`);
  }

  let jsonl: string;
  try {
    jsonl = await decodeSharedTrailPayload(fetched.payloadText);
  } catch (error) {
    return viewerError(gistId, `Failed to decode shared trail payload: ${errorMessage(error)}`);
  }

  let parsed: Awaited<ReturnType<typeof validateTrailJsonl>>;
  try {
    parsed = await validateTrailJsonl(jsonl);
  } catch (error) {
    return viewerError(gistId, `Shared trail contains invalid JSONL: ${errorMessage(error)}`, [
      {
        line: error instanceof JsonlParseError ? error.line : 1,
        path: "/",
        severity: "error",
        code: "invalid_jsonl",
        message: errorMessage(error),
      },
    ]);
  }
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    return {
      title: "Trail viewer",
      status: "error",
      gistId,
      message: "Shared trail failed reader-tolerant validation.",
      diagnostics: parsed.diagnostics,
    };
  }

  const firstHash = parsed.groups[0]?.header.value.content_hash;
  const preview = buildPreview(jsonl);
  return {
    title: "Trail viewer",
    status: "loaded",
    gistId,
    filename: fetched.filename,
    sourceUrl: fetched.sourceUrl,
    contentHash: typeof firstHash === "string" ? firstHash : null,
    diagnostics: parsed.diagnostics,
    summary: {
      records: parsed.records.length,
      sessions: parsed.groups.length,
      warnings: parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
    },
    events: buildViewerEvents(parsed.groups),
    preview: preview.text,
    previewTruncated: preview.truncated,
    previewBytes: preview.bytes,
  };
}

export async function fetchGistPayloadFromGitHub(
  gistId: string,
  fetchImpl: HttpFetch = fetch,
): Promise<GistPayload> {
  const response = await fetchWithTimeout(
    fetchImpl,
    `https://api.github.com/gists/${encodeURIComponent(gistId)}`,
    {
      headers: { Accept: "application/vnd.github+json" },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} ${response.statusText}`);
  }
  const value = JSON.parse(
    await readResponseTextWithLimit(response, GIST_VIEWER_LIMITS.maxMetadataChars),
  ) as {
    files?: Record<string, { filename?: string; raw_url?: string | null; size?: unknown } | null>;
  };
  const metadataFiles = Object.values(value.files ?? {});
  if (metadataFiles.length > GIST_VIEWER_LIMITS.maxMetadataFiles) {
    throw new Error(`gist metadata lists more than ${GIST_VIEWER_LIMITS.maxMetadataFiles} files`);
  }
  const files = metadataFiles.filter(
    (file): file is { filename: string; raw_url: string; size?: unknown } =>
      typeof file?.filename === "string" &&
      file.filename.endsWith(".trail.jsonl.gz.b64") &&
      typeof file.raw_url === "string",
  );
  if (files.length !== 1) {
    throw new Error(`expected exactly one .trail.jsonl.gz.b64 file, found ${files.length}`);
  }

  const file = files[0] as { filename: string; raw_url: string; size?: unknown };
  if (
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size > GIST_VIEWER_LIMITS.maxBase64Chars
  ) {
    throw new Error(`declared payload size exceeds ${GIST_VIEWER_LIMITS.maxBase64Chars} bytes`);
  }
  const raw = await fetchWithTimeout(fetchImpl, file.raw_url);
  if (!raw.ok) {
    throw new Error(`GitHub raw payload returned ${raw.status} ${raw.statusText}`);
  }
  return {
    filename: file.filename,
    payloadText: await readResponseTextWithLimit(raw, GIST_VIEWER_LIMITS.maxBase64Chars),
    sourceUrl: file.raw_url,
  };
}

async function fetchWithTimeout(
  fetchImpl: HttpFetch,
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GIST_VIEWER_LIMITS.fetchTimeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`GitHub request timed out after ${GIST_VIEWER_LIMITS.fetchTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException ||
      (typeof error === "object" && error !== null && "name" in error)) &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

async function validateTrailJsonl(text: string): Promise<{
  diagnostics: ViewerDiagnostic[];
  groups: SessionGroup[];
  records: TrailRecord[];
}> {
  const records = parseTrailJsonl(text);
  const diagnostics: ViewerDiagnostic[] = [];
  const validate = recordValidator();
  for (const record of records) {
    if (validate(record.value)) continue;
    if (isReaderTolerantUnknownRecord(record)) {
      diagnostics.push({
        line: record.line,
        path: "/type",
        severity: "warning",
        code: "reader_tolerant_unknown_record",
        message: `Unknown event type "${String(record.value.type)}" preserved for reader-tolerant parsing`,
      });
      continue;
    }
    for (const error of validate.errors ?? []) {
      diagnostics.push(diagnosticFromSchemaError(error, record.line));
    }
  }

  const groups = splitSessionGroups(records, diagnostics);
  validateRecordTopology(records, diagnostics);
  await verifyContentHashes(groups, records, diagnostics);
  return { diagnostics, groups, records };
}

function parseTrailJsonl(text: string): TrailRecord[] {
  const records: TrailRecord[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new JsonlParseError(i + 1, errorMessage(error));
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new JsonlParseError(i + 1, "line is not a JSON object");
    }
    records.push({ line: i + 1, value: value as Record<string, unknown> });
  }
  return records;
}

function splitSessionGroups(
  records: TrailRecord[],
  diagnostics: ViewerDiagnostic[],
): SessionGroup[] {
  const groups: SessionGroup[] = [];
  let current: SessionGroup | undefined;
  for (const record of records) {
    if (record.value.type === "trail") continue;
    if (record.value.type === "session") {
      current = { header: record, entries: [], records: [record] };
      groups.push(current);
      continue;
    }
    if (current === undefined) {
      diagnostics.push({
        line: record.line,
        path: "/type",
        severity: "error",
        code: "events_before_first_session_header",
        message: "event appears before first session header",
      });
      continue;
    }
    current.entries.push(record);
    current.records.push(record);
  }
  if (groups.length === 0) {
    diagnostics.push({
      line: 1,
      path: "/type",
      severity: "error",
      code: "missing_header",
      message: "trail must contain at least one session header",
    });
  }
  return groups;
}

function validateRecordTopology(records: TrailRecord[], diagnostics: ViewerDiagnostic[]): void {
  const seenIds = new Map<string, TrailRecord>();
  for (const record of records) {
    const id = record.value.id;
    if (typeof id !== "string") continue;
    const prior = seenIds.get(id);
    if (prior !== undefined) {
      diagnostics.push({
        line: record.line,
        path: "/id",
        severity: "error",
        code: "duplicate_id",
        message: `duplicate id ${id} also appears on line ${prior.line}`,
      });
      continue;
    }
    seenIds.set(id, record);
  }

  for (const record of records) {
    const parentId = record.value.parent_id;
    if (typeof parentId !== "string") continue;
    if (!seenIds.has(parentId)) {
      diagnostics.push({
        line: record.line,
        path: "/parent_id",
        severity: "error",
        code: "unknown_parent_id",
        message: `parent_id ${parentId} does not reference a record in this trail`,
      });
    }
  }

  const recordsById = new Map<string, TrailRecord>();
  for (const record of records) {
    const id = record.value.id;
    if (typeof id === "string" && !recordsById.has(id)) recordsById.set(id, record);
  }
  for (const record of recordsById.values()) {
    if (hasParentCycle(record, recordsById)) {
      diagnostics.push({
        line: record.line,
        path: "/parent_id",
        severity: "error",
        code: "parent_cycle",
        message: "parent_id chain contains a cycle",
      });
    }
  }
}

function hasParentCycle(record: TrailRecord, recordsById: Map<string, TrailRecord>): boolean {
  const visited = new Set<string>();
  let current: TrailRecord | undefined = record;
  while (current !== undefined) {
    const id = current.value.id;
    if (typeof id !== "string") return false;
    if (visited.has(id)) return true;
    visited.add(id);
    const parentId = current.value.parent_id;
    if (typeof parentId !== "string") return false;
    current = recordsById.get(parentId);
  }
  return false;
}

async function verifyContentHashes(
  groups: SessionGroup[],
  records: TrailRecord[],
  diagnostics: ViewerDiagnostic[],
): Promise<void> {
  for (const group of groups) {
    await verifyRecordHash(group.records, group.header, "session", diagnostics);
  }
  const envelope = records[0]?.value.type === "trail" ? records[0] : undefined;
  if (envelope !== undefined) {
    await verifyRecordHash(records, envelope, "trail", diagnostics);
  }
}

async function verifyRecordHash(
  records: TrailRecord[],
  hashedRecord: TrailRecord,
  recordType: "session" | "trail",
  diagnostics: ViewerDiagnostic[],
): Promise<void> {
  const expected = hashedRecord.value.content_hash;
  if (expected === undefined || expected === "<pending>") return;
  if (typeof expected !== "string" || !CONTENT_HASH_RE.test(expected)) {
    diagnostics.push({
      line: hashedRecord.line,
      path: "/content_hash",
      severity: "error",
      code: "content_hash_invalid",
      message: "content_hash must be 64 lowercase hex characters",
    });
    return;
  }
  const actual = await sha256Hex(canonicalizeForHash(records, hashedRecord, recordType));
  if (actual !== expected) {
    diagnostics.push({
      line: hashedRecord.line,
      path: "/content_hash",
      severity: "warning",
      code: "content_hash_mismatch",
      message: `content_hash does not match canonical bytes (computed ${actual})`,
    });
  }
}

function canonicalizeForHash(
  records: TrailRecord[],
  hashedRecord: TrailRecord,
  recordType: "session" | "trail",
): string {
  const lines = records.map((record) => {
    const value =
      record === hashedRecord
        ? { ...record.value, type: recordType, content_hash: "<pending>" }
        : record.value;
    const canonical = canonicalize(value);
    if (canonical === undefined) throw new Error(`cannot canonicalize line ${record.line}`);
    return canonical;
  });
  return `${lines.join("\n")}\n`;
}

function isReaderTolerantUnknownRecord(record: TrailRecord): boolean {
  const type = record.value.type;
  if (record.line <= 1 || typeof type !== "string") return false;
  if (type === "session" || type === "trail" || KNOWN_RECORD_TYPES.has(type)) return false;
  return (
    typeof record.value.id === "string" &&
    typeof record.value.ts === "string" &&
    objectValue(record.value.payload) !== undefined
  );
}

const KNOWN_RECORD_TYPES = new Set([
  "agent_message",
  "agent_thinking",
  "branch_point",
  "branch_summary",
  "capability_change",
  "command_invoke",
  "context_compact",
  "mode_change",
  "model_change",
  "session_end",
  "session_metadata_update",
  "session_summary",
  "session_terminated",
  "system_event",
  "task_plan_update",
  "thinking_level_change",
  "tool_call",
  "tool_call_aborted",
  "tool_result",
  "user_interrupt",
  "user_message",
  "user_query",
  "user_query_response",
]);

function buildViewerEvents(groups: SessionGroup[]): ViewerEvent[] {
  return groups.flatMap((group) => group.entries.map(viewerEventFromRecord));
}

function viewerEventFromRecord(record: TrailRecord): ViewerEvent {
  const type = stringValue(record.value.type) ?? "unknown";
  const payload = objectValue(record.value.payload);

  if (type === "user_message") {
    return baseEvent(record, {
      body: stringValue(payload?.text) ?? null,
      kind: "user",
      meta: attachmentMeta(payload),
      title: "User message",
    });
  }

  if (type === "agent_message") {
    return baseEvent(record, {
      body: stringValue(payload?.text) ?? null,
      kind: "agent",
      meta: [
        ...optionalMeta("model", stringValue(payload?.model)),
        ...optionalMeta("stop", stringValue(payload?.stop_reason)),
        ...attachmentMeta(payload),
      ],
      title: "Agent message",
    });
  }

  if (type === "agent_thinking") {
    return baseEvent(record, {
      body: stringValue(payload?.text) ?? null,
      kind: "agent",
      meta: [
        ...optionalMeta("model", stringValue(payload?.model)),
        ...optionalMeta("level", stringValue(payload?.level)),
      ],
      title: "Agent thinking",
    });
  }

  if (type === "tool_call") {
    const tool = stringValue(payload?.tool) ?? "unknown";
    return baseEvent(record, {
      body: summarizeArgs(objectValue(payload?.args)) ?? null,
      kind: "tool_call",
      meta: argsMeta(objectValue(payload?.args)),
      title: `Tool call: ${tool}`,
    });
  }

  if (type === "tool_result") {
    const ok = booleanValue(payload?.ok);
    return baseEvent(record, {
      body: stringValue(payload?.output) ?? stringValue(payload?.error) ?? null,
      kind: "tool_result",
      meta: [
        ...optionalMeta("for", stringValue(payload?.for_id)),
        ...optionalMeta("truncated", booleanValue(payload?.truncated)?.toString()),
        ...optionalMeta("bytes", numberValue(payload?.output_size)?.toString()),
        ...attachmentMeta(payload),
      ],
      status: ok === undefined ? "unknown" : ok ? "ok" : "error",
      title: `Tool result: ${ok === undefined ? "unknown" : ok ? "ok" : "error"}`,
    });
  }

  if (type === "session_summary") {
    return baseEvent(record, {
      body: stringValue(payload?.text) ?? null,
      kind: "summary",
      meta: optionalMeta("scope", stringValue(payload?.scope)),
      title: "Session summary",
    });
  }

  if (type === "branch_point") {
    return baseEvent(record, {
      body: stringValue(payload?.reason) ?? null,
      kind: "notice",
      meta: optionalMeta("from", stringValue(payload?.from_id)),
      title: "Branch point",
    });
  }

  if (type === "branch_summary") {
    return baseEvent(record, {
      body: stringValue(payload?.summary) ?? null,
      kind: "notice",
      meta: optionalMeta("abandoned", stringValue(payload?.abandoned_branch_id)),
      title: "Branch summary",
    });
  }

  return baseEvent(record, {
    body: fallbackBody(payload),
    kind: "fallback",
    meta: [],
    rawJson: cappedJson(record.value),
    title: `Unknown record: ${type}`,
  });
}

function baseEvent(
  record: TrailRecord,
  opts: Omit<ViewerEvent, "id" | "line" | "ts" | "type">,
): ViewerEvent {
  return {
    id: stringValue(record.value.id) ?? null,
    line: record.line,
    ts: stringValue(record.value.ts) ?? null,
    type: stringValue(record.value.type) ?? "unknown",
    ...opts,
  };
}

function fallbackBody(payload: Record<string, unknown> | undefined): string | null {
  return stringValue(payload?.text) ?? stringValue(payload?.summary) ?? null;
}

function attachmentMeta(
  payload: Record<string, unknown> | undefined,
): { label: string; value: string }[] {
  const attachments = payload?.attachments;
  return Array.isArray(attachments) && attachments.length > 0
    ? [{ label: "attachments", value: String(attachments.length) }]
    : [];
}

function argsMeta(args: Record<string, unknown> | undefined): { label: string; value: string }[] {
  if (args === undefined) return [];
  return Object.entries(args).map(([label, value]) => ({ label, value: compactValue(value) }));
}

function optionalMeta(
  label: string,
  value: string | undefined,
): { label: string; value: string }[] {
  return value === undefined || value.length === 0 ? [] : [{ label, value }];
}

function summarizeArgs(args: Record<string, unknown> | undefined): string | null {
  if (args === undefined) return null;
  const path = stringValue(args.path);
  if (path !== undefined) return path;
  const command = stringValue(args.command);
  if (command !== undefined) return command;
  const query = stringValue(args.query);
  if (query !== undefined) return query;
  return cappedJson(args, 600);
}

function compactValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return cappedJson(value, 240);
}

function cappedJson(value: unknown, maxLength = 2_000): string {
  const text = JSON.stringify(value, null, 2) ?? "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... truncated`;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function decodeSharedTrailPayload(payloadText: string): Promise<string> {
  const base64 = payloadText.replace(/\s+/g, "");
  if (base64.length > GIST_VIEWER_LIMITS.maxBase64Chars) {
    throw new Error(`payload exceeds ${GIST_VIEWER_LIMITS.maxBase64Chars} base64 characters`);
  }
  const compressed = base64ToBytes(base64);
  if (compressed.byteLength > GIST_VIEWER_LIMITS.maxCompressedBytes) {
    throw new Error(`compressed payload exceeds ${GIST_VIEWER_LIMITS.maxCompressedBytes} bytes`);
  }
  const decoded = await gunzipWithLimit(compressed, GIST_VIEWER_LIMITS.maxDecodedBytes);
  return new TextDecoder().decode(decoded);
}

async function gunzipWithLimit(compressed: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const compressedBytes = compressed.buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  ) as ArrayBuffer;
  const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`decoded payload exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readResponseTextWithLimit(response: Response, maxChars: number): Promise<string> {
  if (response.body === null) {
    const text = await response.text();
    if (text.length > maxChars) throw new Error(`payload exceeds ${maxChars} characters`);
    return text.trim();
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += value;
    if (output.length > maxChars) {
      await reader.cancel();
      throw new Error(`payload exceeds ${maxChars} characters`);
    }
  }
  return output.trim();
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildPreview(text: string): { bytes: number; text: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= GIST_VIEWER_LIMITS.maxPreviewBytes) {
    return { bytes: bytes.byteLength, text, truncated: false };
  }
  const previewBytes = bytes.slice(0, GIST_VIEWER_LIMITS.maxPreviewBytes);
  return {
    bytes: bytes.byteLength,
    text: `${new TextDecoder().decode(previewBytes)}\n… preview truncated at ${GIST_VIEWER_LIMITS.maxPreviewBytes} bytes`,
    truncated: true,
  };
}

let validateRecord: ReturnType<Ajv2020["compile"]> | undefined;

function recordValidator(): ReturnType<Ajv2020["compile"]> {
  validateRecord ??= new Ajv2020({ strict: false }).compile(schema);
  return validateRecord;
}

function diagnosticFromSchemaError(error: ErrorObject, line: number): ViewerDiagnostic {
  return {
    line,
    path: error.instancePath || "/",
    severity: "error",
    code: error.keyword,
    message: error.message ?? "record failed schema validation",
  };
}

function viewerError(
  gistId: string,
  message: string,
  diagnostics: ViewerDiagnostic[] = [],
): GistViewerModel {
  return {
    title: "Trail viewer",
    status: "error",
    gistId,
    message,
    diagnostics,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
