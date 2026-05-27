import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  IndexCorruptError,
  type IndexFile,
  IndexVersionError,
  objectPath,
  readIndex,
  resolveStoreRoot,
} from "@agent-trail/store";
import { boundedBy, parseTimeBounds, renderJson } from "./listing.ts";

export type RunListResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunListOptions = {
  storeRoot?: string;
};

type RowKind = "session" | "trail";

type Row = {
  content_hash: string;
  agent: string | null;
  cwd: string | null;
  registered_at: string;
  source_path: string | null;
  kind: RowKind;
};

const USAGE =
  "Usage: trail list [--json] [--agent <name>] [--cwd <path>] [--since <iso>] [--until <iso>] [--kind session|trail]";
const SHORT_HASH_LEN = 12;
const MISSING_TEXT = "-";
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

export async function runList(argv: string[], opts: RunListOptions = {}): Promise<RunListResult> {
  const parseConfig = {
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      agent: { type: "string" },
      cwd: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      kind: { type: "string" },
    },
    allowPositionals: false,
  } as const;

  type Values = {
    json: boolean;
    agent?: string;
    cwd?: string;
    since?: string;
    until?: string;
    kind?: string;
  };
  let values: Values;
  try {
    const parsed = parseArgs(parseConfig);
    values = parsed.values as Values;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n${USAGE}\n` };
  }

  let storeRoot: string;
  try {
    storeRoot = resolveStoreRoot(opts.storeRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }
  let index: IndexFile;
  try {
    index = await readIndex(storeRoot);
  } catch (error) {
    if (error instanceof IndexCorruptError || error instanceof IndexVersionError) {
      return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
    }
    throw error;
  }
  const entries = Object.entries(index.entries);

  const rows: Row[] = [];
  const warnings: string[] = [];
  for (const [contentHash, rawEntry] of entries) {
    // Index keys are content_hashes (sha256 hex). Reject anything else before
    // composing a filesystem path so a corrupted/malicious index cannot turn
    // path.join() into an escape from objects/sha256/.
    if (!CONTENT_HASH_RE.test(contentHash)) {
      warnings.push(`warning: skipping malformed index key: ${contentHash}`);
      continue;
    }
    // readIndex only validates that `entries` is an object; individual values
    // could be null/array/string after a hand edit. Guard before dereferencing.
    const entry = normalizeIndexEntry(rawEntry);
    if (entry === null) {
      warnings.push(`warning: skipping malformed index entry for ${contentHash}`);
      continue;
    }
    const headerResult = await readHeader(storeRoot, contentHash);
    if (headerResult.error !== null) {
      warnings.push(`warning: could not read header for ${contentHash}: ${headerResult.error}`);
    }
    rows.push({
      content_hash: contentHash,
      agent: extractAgentName(headerResult.header),
      cwd: extractCwd(headerResult.header),
      registered_at: entry.registered_at,
      source_path: entry.source_path,
      kind: entry.kind,
    });
  }

  const { sinceMs, untilMs, errors: boundErrors } = parseTimeBounds(values.since, values.until);
  if (boundErrors.length > 0) {
    return { exitCode: 1, stdout: "", stderr: `${boundErrors.join("\n")}\n` };
  }

  if (values.kind !== undefined && values.kind !== "session" && values.kind !== "trail") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `--kind must be "session" or "trail"; got "${values.kind}"\n${USAGE}\n`,
    };
  }
  const kindFilter = values.kind as RowKind | undefined;

  const filtered = rows.filter((r) => {
    if (values.agent !== undefined && r.agent !== values.agent) return false;
    if (values.cwd !== undefined && r.cwd !== values.cwd) return false;
    if (kindFilter !== undefined && r.kind !== kindFilter) return false;
    return boundedBy(r.registered_at, sinceMs, untilMs);
  });

  filtered.sort((a, b) => {
    if (a.registered_at !== b.registered_at) {
      return a.registered_at < b.registered_at ? 1 : -1;
    }
    return a.content_hash < b.content_hash ? -1 : 1;
  });

  const stderr = warnings.length === 0 ? "" : `${warnings.join("\n")}\n`;
  if (values.json) {
    return { exitCode: 0, stdout: renderJson(filtered), stderr };
  }
  if (filtered.length === 0) {
    return { exitCode: 0, stdout: "", stderr };
  }
  return { exitCode: 0, stdout: renderText(filtered), stderr };
}

function renderText(rows: Row[]): string {
  return `${rows
    .map(
      (r) =>
        `${r.content_hash.slice(0, SHORT_HASH_LEN)}  ${r.kind}  ${r.agent ?? MISSING_TEXT}  ${
          r.cwd ?? MISSING_TEXT
        }  ${r.registered_at}  ${r.source_path ?? MISSING_TEXT}`,
    )
    .join("\n")}\n`;
}

type HeaderReadResult = {
  header: Record<string, unknown> | null;
  error: string | null;
};

// Reads only the first JSONL line (the session header) to extract agent.name
// and cwd. Capped at 8KB: spec v0.1.0 session headers are small JSON objects;
// a realistic header fits well inside this window. Oversized headers will
// degrade gracefully to `agent: null` / `cwd: null` in the listing rather
// than aborting. Revisit if real corpora exceed this.
const HEADER_READ_BYTES = 8192;

async function readHeader(storeRoot: string, contentHash: string): Promise<HeaderReadResult> {
  const path = objectPath(storeRoot, contentHash);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, "r");
    const buf = new Uint8Array(HEADER_READ_BYTES);
    const { bytesRead } = await handle.read(buf, 0, buf.byteLength, 0);
    if (bytesRead === 0) return { header: null, error: "empty object file" };
    const slice = buf.subarray(0, bytesRead);
    const newlineIdx = slice.indexOf(0x0a);
    const lineBytes = newlineIdx === -1 ? slice : slice.subarray(0, newlineIdx);
    const line = new TextDecoder("utf-8").decode(lineBytes).replace(/\r$/, "");
    if (line.length === 0) return { header: null, error: "empty header line" };
    const value = JSON.parse(line) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { header: null, error: "header is not a JSON object" };
    }
    return { header: value as Record<string, unknown>, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { header: null, error: message };
  } finally {
    if (handle !== null) {
      await handle.close().catch(() => {});
    }
  }
}

function extractAgentName(header: Record<string, unknown> | null): string | null {
  if (header === null) return null;
  const agent = header.agent;
  if (typeof agent !== "object" || agent === null || Array.isArray(agent)) return null;
  const name = (agent as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

type NormalizedEntry = {
  registered_at: string;
  source_path: string | null;
  kind: RowKind;
};

function normalizeIndexEntry(raw: unknown): NormalizedEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const registeredAt = record.registered_at;
  if (typeof registeredAt !== "string") return null;
  const sourcePath = record.source_path;
  if (sourcePath !== null && typeof sourcePath !== "string") return null;
  const rawKind = record.kind;
  // Missing `kind` defaults to "session" so pre-multi-session index entries
  // keep listing under the existing single-session shape.
  const kind: RowKind = rawKind === "trail" ? "trail" : "session";
  return { registered_at: registeredAt, source_path: sourcePath, kind };
}

function extractCwd(header: Record<string, unknown> | null): string | null {
  if (header === null) return null;
  const cwd = header.cwd;
  return typeof cwd === "string" ? cwd : null;
}
