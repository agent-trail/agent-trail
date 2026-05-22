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

export type RunListResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunListOptions = {
  storeRoot?: string;
};

type Row = {
  content_hash: string;
  agent: string | null;
  cwd: string | null;
  registered_at: string;
  source_path: string | null;
};

const USAGE =
  "Usage: trail list [--json] [--agent <name>] [--cwd <path>] [--since <iso>] [--until <iso>]";
const SHORT_HASH_LEN = 12;
const MISSING_TEXT = "-";

export async function runList(argv: string[], opts: RunListOptions = {}): Promise<RunListResult> {
  const parseConfig = {
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      agent: { type: "string" },
      cwd: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
    },
    allowPositionals: false,
  } as const;

  type Values = {
    json: boolean;
    agent?: string;
    cwd?: string;
    since?: string;
    until?: string;
  };
  let values: Values;
  try {
    const parsed = parseArgs(parseConfig);
    values = parsed.values as Values;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n${USAGE}\n` };
  }

  const storeRoot = resolveStoreRoot(opts.storeRoot);
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
  for (const [contentHash, entry] of entries) {
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
    });
  }

  const sinceMs = parseBound(values.since);
  const untilMs = parseBound(values.until);
  const boundErrors: string[] = [];
  if (values.since !== undefined && sinceMs === null) {
    boundErrors.push(`invalid --since value: ${values.since}`);
  }
  if (values.until !== undefined && untilMs === null) {
    boundErrors.push(`invalid --until value: ${values.until}`);
  }
  if (boundErrors.length > 0) {
    return { exitCode: 1, stdout: "", stderr: `${boundErrors.join("\n")}\n` };
  }

  const filtered = rows.filter((r) => {
    if (values.agent !== undefined && r.agent !== values.agent) return false;
    if (values.cwd !== undefined && r.cwd !== values.cwd) return false;
    if (sinceMs !== null || untilMs !== null) {
      const ts = Date.parse(r.registered_at);
      if (Number.isNaN(ts)) return false;
      if (sinceMs !== null && ts < sinceMs) return false;
      if (untilMs !== null && ts >= untilMs) return false;
    }
    return true;
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
        `${r.content_hash.slice(0, SHORT_HASH_LEN)}  ${r.agent ?? MISSING_TEXT}  ${
          r.cwd ?? MISSING_TEXT
        }  ${r.registered_at}  ${r.source_path ?? MISSING_TEXT}`,
    )
    .join("\n")}\n`;
}

function renderJson(rows: Row[]): string {
  return `${JSON.stringify(rows)}\n`;
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

function parseBound(value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function extractCwd(header: Record<string, unknown> | null): string | null {
  if (header === null) return null;
  const cwd = header.cwd;
  return typeof cwd === "string" ? cwd : null;
}
