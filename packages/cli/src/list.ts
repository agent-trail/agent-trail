import { open } from "node:fs/promises";
import { basename } from "node:path";
import {
  type DetectOptions,
  DISCOVERY_CONCURRENCY_LIMIT,
  mapConcurrent,
  type SessionRef,
} from "@agent-trail/adapters";
import {
  IndexCorruptError,
  type IndexFile,
  IndexVersionError,
  objectPath,
  readIndex,
  resolveStoreRoot,
} from "@agent-trail/store";
import type { Command } from "commander";
import { cliDefaultAdapters, type TrailAdapter } from "./adapters.ts";
import { addExamples, type ResultWriter } from "./command.ts";
import type { ResolvedConfig } from "./config.ts";
import { runExport } from "./export.ts";
import type { Row, RowKind } from "./list-model.ts";
import {
  adapterMatchesAgent,
  boundedBy,
  includesQuery,
  parseLimit,
  parseTimeBounds,
  renderJson,
} from "./listing.ts";
import { registerFromAdapter } from "./register.ts";
import { enrichBrowserRows } from "./session-browser-metadata.ts";
import type { BrowserScopeMode, SessionBrowserInput } from "./session-browser-state.ts";
import { type GistUpload, runShare } from "./share.ts";
import type { TerminalIo } from "./terminal.ts";

export type RunListResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunListOptions = {
  json?: boolean;
  plain?: boolean;
  all?: boolean;
  sourceCwd?: string;
  agent?: string;
  cwd?: string;
  since?: string;
  until?: string;
  source?: string;
  limit?: string;
  search?: string;
  caseSensitive?: boolean;
};

export type RunListContext = {
  storeRoot?: string;
  config?: ResolvedConfig;
  adapters?: readonly TrailAdapter[];
  defaultCwd?: string;
  terminal?: TerminalIo;
  runSessionBrowser?: (input: SessionBrowserInput) => Promise<RunListResult>;
  confirmShare?: (message: string) => Promise<boolean>;
  gistUpload?: GistUpload;
  exportDir?: string;
};

type SourceRow = {
  source_id: string;
  source_agent: string;
  source_cwd: string | null;
  source_modified_at: string | null;
  source_path: string | null;
};

type RegisteredRow = {
  content_hash: string;
  registered_agent: string | null;
  registered_cwd: string | null;
  registered_at: string | null;
  registered_source_path: string | null;
  registered_kind: RowKind;
};

export type { Row } from "./list-model.ts";

type HeaderReadResult = {
  header: Record<string, unknown> | null;
  error: string | null;
};

type CollectedRowsResult =
  | {
      exitCode: 0;
      rows: Row[];
      warnings: string[];
    }
  | RunListResult;

const SHORT_HASH_LEN = 12;
const MISSING_TEXT = "-";
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;
const SEARCH_HEAD_BYTES = 65_536;

export async function runList(
  options: RunListOptions = {},
  context: RunListContext = {},
): Promise<RunListResult> {
  if (options.json === true && options.plain === true) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "error: --json and --plain cannot be used together\n",
    };
  }

  const collected = await collectListRows(options, context);
  if ("stdout" in collected) return collected;

  const stderr = collected.warnings.length === 0 ? "" : `${collected.warnings.join("\n")}\n`;
  if (options.json === true) {
    return { exitCode: 0, stdout: renderJson(collected.rows), stderr };
  }
  if (collected.rows.length === 0) {
    return { exitCode: 0, stdout: "", stderr };
  }
  return { exitCode: 0, stdout: renderText(collected.rows), stderr };
}

async function collectListRows(
  options: RunListOptions,
  context: RunListContext,
): Promise<CollectedRowsResult> {
  let storeRoot: string;
  try {
    storeRoot = resolveStoreRoot(context.storeRoot);
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

  const sourceMode = options.source ?? "all";
  if (sourceMode !== "all" && sourceMode !== "source" && sourceMode !== "registered") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `--source must be "all", "source", or "registered"; got "${sourceMode}"\n`,
    };
  }

  const parsedLimit = parseLimit(options.limit);
  if (parsedLimit.error !== undefined) {
    return { exitCode: 1, stdout: "", stderr: `${parsedLimit.error}\n` };
  }

  const warnings: string[] = [];
  const registeredRows: RegisteredRow[] = [];
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
    registeredRows.push({
      content_hash: contentHash,
      registered_agent: extractAgentName(headerResult.header),
      registered_cwd: extractCwd(headerResult.header),
      registered_at: entry.registered_at,
      registered_source_path: entry.source_path,
      registered_kind: entry.kind,
    });
  }

  const sourceRows = await detectSourceRows(options, context, warnings);
  const rows = mergeRows(sourceRows, registeredRows);

  const { sinceMs, untilMs, errors: boundErrors } = parseTimeBounds(options.since, options.until);
  if (boundErrors.length > 0) {
    return { exitCode: 1, stdout: "", stderr: `${boundErrors.join("\n")}\n` };
  }

  const agentFilter = options.agent ?? context.config?.config.sources.defaultFilter ?? undefined;
  const sourceFiltered = rows.filter((r) => {
    if (sourceMode === "source" && r.state === "registered") return false;
    if (sourceMode === "registered" && r.state === "source") return false;
    if (!rowMatchesAgent(r, agentFilter)) return false;
    // Source discovery defaults to the current cwd for parity with `trail discover`,
    // while registered store rows stay broad unless the user explicitly passes --cwd.
    if (options.all !== true && options.cwd !== undefined && r.cwd !== options.cwd) return false;
    return boundedBy(r.latest_at, sinceMs, untilMs);
  });

  let filtered = sourceFiltered;
  const search = options.search;
  if (search !== undefined) {
    const matches = await mapConcurrent(sourceFiltered, DISCOVERY_CONCURRENCY_LIMIT, async (row) =>
      matchesSearch(storeRoot, row, search, options.caseSensitive === true),
    );
    filtered = sourceFiltered.filter((_row, index) => matches[index] === true);
  }

  filtered.sort((a, b) => {
    if (a.latest_at !== b.latest_at) {
      if (a.latest_at === null) return 1;
      if (b.latest_at === null) return -1;
      return a.latest_at < b.latest_at ? 1 : -1;
    }
    return rowIdentity(a).localeCompare(rowIdentity(b));
  });

  const renderedRows =
    parsedLimit.limit === undefined ? filtered : filtered.slice(0, parsedLimit.limit);
  if (parsedLimit.limit !== undefined && filtered.length > parsedLimit.limit) {
    warnings.push(`warning: ${filtered.length} rows matched; showing first ${parsedLimit.limit}`);
  }

  return { exitCode: 0, rows: renderedRows, warnings };
}

export async function runListBrowser(
  options: RunListOptions = {},
  context: RunListContext = {},
): Promise<RunListResult> {
  let storeRoot: string;
  try {
    storeRoot = resolveStoreRoot(context.storeRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }
  const browserCwd = options.cwd ?? context.defaultCwd ?? process.cwd();
  const initialScope: BrowserScopeMode = options.all === true ? "all" : "cwd";
  const input = await collectBrowserInput(options, context, storeRoot, initialScope, browserCwd);
  if ("stdout" in input) return input;
  const runSessionBrowser =
    context.runSessionBrowser ??
    (async (input: SessionBrowserInput) => {
      const { runSessionBrowserTui } = await import("./session-browser-tui.ts");
      return runSessionBrowserTui(input, context.terminal);
    });
  return runSessionBrowser(input);
}

export function shouldRunListBrowser(options: RunListOptions, terminal?: TerminalIo): boolean {
  return terminal?.isTTY === true && options.json !== true && options.plain !== true;
}

async function collectBrowserInput(
  options: RunListOptions,
  context: RunListContext,
  storeRoot: string,
  scope: BrowserScopeMode,
  browserCwd: string,
): Promise<SessionBrowserInput | RunListResult> {
  const scopedOptions = browserScopedOptions(options, scope, browserCwd);
  const result = await collectListRows(scopedOptions, context);
  if ("stdout" in result) return result;
  const rows = await enrichBrowserRows(storeRoot, result.rows);
  return {
    rows,
    warnings: result.warnings,
    scope: browserScope(scope, browserCwd),
    onShare: async (row, actionContext) => {
      const registered = await ensureBrowserRowRegistered(row, options, context, storeRoot);
      const shared = await runShare(
        { id: registered.contentHash, json: true },
        {
          storeRoot,
          confirm: context.confirmShare ?? actionContext?.confirm,
          gistUpload: context.gistUpload,
        },
      );
      const parsed = parseShareJson(shared.stdout);
      const next = await collectBrowserInput(options, context, storeRoot, scope, browserCwd);
      const refreshedRows = "stdout" in next ? undefined : next.rows;
      if (shared.exitCode !== 0) {
        throw new Error(shared.stderr.trim() || "share failed");
      }
      if (parsed.status === "cancelled") {
        return { message: "Share cancelled.", rows: refreshedRows };
      }
      const url = typeof parsed.url === "string" ? parsed.url : undefined;
      return {
        message: url === undefined ? "Shared trail" : `Shared ${url}`,
        rows: refreshedRows,
        url,
      };
    },
    onExport: async (row) => {
      const registered = await ensureBrowserRowRegistered(row, options, context, storeRoot);
      const out = browserExportPath(context.exportDir ?? browserCwd, registered.contentHash);
      const exported = await runExport({ id: registered.contentHash, out }, { storeRoot });
      if (exported.exitCode !== 0) {
        throw new Error(exported.stderr.trim() || "export failed");
      }
      const next = await collectBrowserInput(options, context, storeRoot, scope, browserCwd);
      return {
        message: `Exported ${registered.contentHash.slice(0, SHORT_HASH_LEN)} to ${out}`,
        rows: "stdout" in next ? undefined : next.rows,
      };
    },
    onCopyUrl: async (url) => {
      if (context.terminal?.stdout === undefined) return { message: "Copy unsupported" };
      writeOsc52(context.terminal.stdout, url);
      return { message: "Copied URL" };
    },
    onToggleScope: async (nextScope) => {
      const next = await collectBrowserInput(options, context, storeRoot, nextScope, browserCwd);
      if ("stdout" in next) {
        return {
          rows: [],
          warnings: [next.stderr.trim() || "error: failed to load rows"],
          scope: browserScope(nextScope, browserCwd),
        };
      }
      return next;
    },
  };
}

type BrowserRegistration = { contentHash: string };

async function ensureBrowserRowRegistered(
  row: Row,
  _options: RunListOptions,
  context: RunListContext,
  storeRoot: string,
): Promise<BrowserRegistration> {
  if (row.content_hash !== null) return { contentHash: row.content_hash };
  if (row.source_id === null || row.source_agent === null) {
    throw new Error("selected row has no source session to register");
  }
  const adapters = context.adapters ?? cliDefaultAdapters();
  const adapter = adapters.find((candidate) => candidate.name === row.source_agent);
  if (adapter === undefined) {
    throw new Error(`no adapter available for ${row.source_agent}`);
  }
  const reg = await registerFromAdapter(
    {
      id: row.source_id,
      adapter: row.source_agent,
      cwd: row.source_cwd ?? undefined,
      modifiedAt: row.source_modified_at ?? undefined,
      path: row.source_path ?? undefined,
    },
    { adapter, storeRoot },
  );
  if (reg.contentHash === null) {
    throw new Error(`register failed: ${reg.status}`);
  }
  return { contentHash: reg.contentHash };
}

function parseShareJson(stdout: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function browserExportPath(dir: string, contentHash: string): string {
  return `${dir.replace(/\/$/, "")}/${contentHash.slice(0, SHORT_HASH_LEN)}.trail.jsonl`;
}

function writeOsc52(stdout: NodeJS.WriteStream, text: string): void {
  const payload = Buffer.from(text, "utf8").toString("base64");
  stdout.write(`\u001b]52;c;${payload}\u0007`);
}

function browserScopedOptions(
  options: RunListOptions,
  scope: BrowserScopeMode,
  browserCwd: string,
): RunListOptions {
  if (scope === "all") return { ...options, all: true };
  return { ...options, all: false, sourceCwd: browserCwd };
}

function browserScope(
  scope: BrowserScopeMode,
  browserCwd: string,
): NonNullable<SessionBrowserInput["scope"]> {
  return {
    mode: scope,
    label: scope === "all" ? "all" : basename(browserCwd) || browserCwd,
  };
}

function renderText(rows: Row[]): string {
  return `${rows
    .map((r) => {
      const id = r.source_id ?? r.content_hash?.slice(0, SHORT_HASH_LEN) ?? MISSING_TEXT;
      const cue = r.source_path ?? r.registered_source_path ?? r.content_hash ?? MISSING_TEXT;
      return `${id.slice(0, SHORT_HASH_LEN)}  ${r.state}  ${r.agent ?? MISSING_TEXT}  ${
        r.cwd ?? MISSING_TEXT
      }  ${r.latest_at ?? MISSING_TEXT}  ${cue}`;
    })
    .join("\n")}\n`;
}

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
    const head = new TextDecoder("utf-8").decode(slice);
    const lines = head.split("\n");
    if (bytesRead === buf.byteLength && !head.endsWith("\n")) lines.pop();
    let firstObject: Record<string, unknown> | null = null;
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (line.length === 0) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        continue;
      }
      const object = value as Record<string, unknown>;
      firstObject ??= object;
      if (object.type === "session") return { header: object, error: null };
    }
    if (firstObject === null) return { header: null, error: "empty header line" };
    return { header: firstObject, error: null };
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

async function detectSourceRows(
  options: RunListOptions,
  context: RunListContext,
  warnings: string[],
): Promise<SourceRow[]> {
  const agentFilter = options.agent ?? context.config?.config.sources.defaultFilter ?? undefined;
  const adapters = (context.adapters ?? cliDefaultAdapters()).filter((a) =>
    adapterMatchesAgent(a.name, agentFilter),
  );
  const detectOpts: DetectOptions = {};
  const requestedCwd =
    options.all === true
      ? undefined
      : (options.sourceCwd ?? options.cwd ?? context.defaultCwd ?? process.cwd());
  if (options.all === true) {
    detectOpts.allCwds = true;
  } else if (requestedCwd !== undefined) {
    detectOpts.cwd = requestedCwd;
  }
  const perAdapter = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return await adapter.detectSessions(detectOpts);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`warning: ${adapter.name} detectSessions failed: ${message}`);
        return [] as SessionRef[];
      }
    }),
  );
  let refs = perAdapter.flat();
  if (options.all !== true && requestedCwd !== undefined) {
    refs = refs.filter((r) => r.cwd === undefined || r.cwd === requestedCwd);
  }
  return refs.map((ref) => ({
    source_id: ref.id,
    source_agent: ref.adapter,
    source_cwd: ref.cwd ?? null,
    source_modified_at: ref.modifiedAt ?? null,
    source_path: ref.path ?? null,
  }));
}

function mergeRows(sourceRows: SourceRow[], registeredRows: RegisteredRow[]): Row[] {
  const rows: Row[] = [];
  const usedRegistered = new Set<number>();
  const sourcePaths = new Set(
    sourceRows.flatMap((source) => (source.source_path === null ? [] : [source.source_path])),
  );
  for (const source of sourceRows) {
    const matchIndex = findNewestPathMatch(source, registeredRows, usedRegistered);
    if (matchIndex === -1) {
      rows.push(toUnified(source, null));
      continue;
    }
    usedRegistered.add(matchIndex);
    rows.push(toUnified(source, registeredRows[matchIndex] as RegisteredRow));
  }
  for (const [index, registered] of registeredRows.entries()) {
    if (usedRegistered.has(index)) continue;
    if (
      registered.registered_source_path !== null &&
      sourcePaths.has(registered.registered_source_path)
    ) {
      continue;
    }
    rows.push(toUnified(null, registered));
  }
  return rows;
}

function findNewestPathMatch(
  source: SourceRow,
  registeredRows: RegisteredRow[],
  usedRegistered: Set<number>,
): number {
  if (source.source_path === null) return -1;
  let matchIndex = -1;
  let matchRegisteredAt: string | null = null;
  for (const [index, registered] of registeredRows.entries()) {
    if (usedRegistered.has(index)) continue;
    if (registered.registered_source_path !== source.source_path) continue;
    const current =
      matchIndex === -1 ? null : (registeredRows[matchIndex] as RegisteredRow | undefined);
    const timestampComparison =
      current === null || current === undefined
        ? 1
        : compareNullableTimestamps(registered.registered_at, matchRegisteredAt);
    if (
      matchIndex === -1 ||
      timestampComparison > 0 ||
      (timestampComparison === 0 &&
        registered.registered_kind === "trail" &&
        current?.registered_kind !== "trail")
    ) {
      matchIndex = index;
      matchRegisteredAt = registered.registered_at;
    }
  }
  return matchIndex;
}

function toUnified(source: SourceRow | null, registered: RegisteredRow | null): Row {
  return {
    state:
      source !== null && registered !== null
        ? "source+registered"
        : source !== null
          ? "source"
          : "registered",
    source_id: source?.source_id ?? null,
    source_agent: source?.source_agent ?? null,
    source_cwd: source?.source_cwd ?? null,
    source_modified_at: source?.source_modified_at ?? null,
    source_path: source?.source_path ?? null,
    content_hash: registered?.content_hash ?? null,
    registered_agent: registered?.registered_agent ?? null,
    registered_cwd: registered?.registered_cwd ?? null,
    registered_at: registered?.registered_at ?? null,
    registered_source_path: registered?.registered_source_path ?? null,
    registered_kind: registered?.registered_kind ?? null,
    agent: source?.source_agent ?? registered?.registered_agent ?? null,
    cwd: source?.source_cwd ?? registered?.registered_cwd ?? null,
    latest_at: latestTimestamp(
      source?.source_modified_at ?? null,
      registered?.registered_at ?? null,
    ),
  };
}

function latestTimestamp(
  sourceModifiedAt: string | null,
  registeredAt: string | null,
): string | null {
  return compareNullableTimestamps(sourceModifiedAt, registeredAt) >= 0
    ? sourceModifiedAt
    : registeredAt;
}

function compareNullableTimestamps(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(aMs) && Number.isNaN(bMs)) return a.localeCompare(b);
  if (Number.isNaN(aMs)) return -1;
  if (Number.isNaN(bMs)) return 1;
  return aMs - bMs;
}

function rowMatchesAgent(row: Row, agentFilter: string | undefined): boolean {
  if (agentFilter === undefined) return true;
  if (row.source_agent !== null && adapterMatchesAgent(row.source_agent, agentFilter)) return true;
  return row.registered_agent === agentFilter;
}

function rowIdentity(row: Row): string {
  return row.source_id ?? row.content_hash ?? "";
}

function rowMetadata(row: Row): string {
  return [
    row.state,
    row.source_id,
    row.source_agent,
    row.source_cwd,
    row.source_modified_at,
    row.source_path,
    row.content_hash,
    row.registered_agent,
    row.registered_cwd,
    row.registered_at,
    row.registered_source_path,
    row.registered_kind,
    row.agent,
    row.cwd,
    row.latest_at,
  ]
    .filter((value): value is string => value !== null)
    .join("\n");
}

async function readHead(path: string): Promise<string> {
  return Bun.file(path).slice(0, SEARCH_HEAD_BYTES).text();
}

async function matchesSearch(
  storeRoot: string,
  row: Row,
  query: string,
  caseSensitive: boolean,
): Promise<boolean> {
  if (includesQuery(rowMetadata(row), query, caseSensitive)) return true;
  const paths = [
    row.source_path,
    row.content_hash === null ? null : objectPath(storeRoot, row.content_hash),
  ].filter((value): value is string => value !== null);
  for (const path of paths) {
    try {
      if (includesQuery(await readHead(path), query, caseSensitive)) return true;
    } catch {
      // Best-effort search: unreadable source/object head is a non-match.
    }
  }
  return false;
}

export function addListCommand(
  program: Command,
  writeResult: ResultWriter,
  context: RunListContext = {},
): void {
  addExamples(
    program
      .command("list")
      .option("--json", "Print entries as JSON.", false)
      .option("--plain", "Print entries as a plain table.", false)
      .option("--source <source>", "Filter by source state: all, source, or registered.", "all")
      .option("--agent <name>", "Filter by agent name.")
      .option("--cwd <path>", "Filter by cwd.")
      .option("--since <iso>", "Include rows at or after this time.")
      .option("--until <iso>", "Include rows before this time.")
      .option("--limit <n>", "Limit result rows after sorting.")
      .option("--search <query>", "Filter rows by substring in content or metadata.")
      .option("--case-sensitive", "Make --search matching case-sensitive.", false)
      .description("List source sessions and registered Trail objects.")
      .action(async (options: RunListOptions) => {
        writeResult(
          shouldRunListBrowser(options, context.terminal)
            ? await runListBrowser(options, context)
            : await runList(options, context),
        );
      }),
    ["trail list", "trail list --source registered --agent codex-cli"],
  );
}
