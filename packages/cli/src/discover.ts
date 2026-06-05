import {
  type DetectOptions,
  defaultTrailAdapters,
  type SessionRef,
  type TrailAdapter,
} from "@agent-trail/adapters";
import type { Command } from "commander";
import { addExamples, type ResultWriter } from "./command.ts";
import { boundedBy, parseTimeBounds, renderJson } from "./listing.ts";

export type RunDiscoverResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunDiscoverOptions = {
  adapters?: TrailAdapter[];
  defaultCwd?: string;
  json?: boolean;
  all?: boolean;
  agent?: string;
  cwd?: string;
  since?: string;
  until?: string;
  limit?: string;
  search?: string;
  caseSensitive?: boolean;
};

type Row = {
  id: string;
  adapter: string;
  cwd: string | null;
  modified_at: string | null;
  path: string | null;
};

const SHORT_ID_LEN = 12;
const MISSING_TEXT = "-";
const SEARCH_HEAD_BYTES = 65_536;

function parseLimit(limit: string | undefined): { limit?: number; error?: string } {
  if (limit === undefined) return {};
  if (!/^[1-9]\d*$/.test(limit)) {
    return { error: `invalid --limit: expected positive integer, got '${limit}'` };
  }
  return { limit: Number.parseInt(limit, 10) };
}

function includesQuery(value: string, query: string, caseSensitive: boolean): boolean {
  if (caseSensitive) return value.includes(query);
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function rowMetadata(row: Row): string {
  return [row.id, row.adapter, row.cwd, row.modified_at, row.path]
    .filter((value): value is string => value !== null)
    .join("\n");
}

async function readSearchHead(path: string): Promise<string> {
  return Bun.file(path).slice(0, SEARCH_HEAD_BYTES).text();
}

async function matchesSearch(row: Row, query: string, caseSensitive: boolean): Promise<boolean> {
  if (includesQuery(rowMetadata(row), query, caseSensitive)) return true;
  if (row.path === null) return false;
  try {
    return includesQuery(await readSearchHead(row.path), query, caseSensitive);
  } catch {
    return false;
  }
}

export async function runDiscover(options: RunDiscoverOptions = {}): Promise<RunDiscoverResult> {
  const { sinceMs, untilMs, errors: boundErrors } = parseTimeBounds(options.since, options.until);
  if (boundErrors.length > 0) {
    return { exitCode: 1, stdout: "", stderr: `${boundErrors.join("\n")}\n` };
  }
  const parsedLimit = parseLimit(options.limit);
  if (parsedLimit.error !== undefined) {
    return { exitCode: 1, stdout: "", stderr: `${parsedLimit.error}\n` };
  }

  const adapters = (options.adapters ?? defaultTrailAdapters()).filter(
    (a) => options.agent === undefined || a.name === options.agent,
  );

  const detectOpts: DetectOptions = {};
  const requestedCwd = options.cwd ?? options.defaultCwd;
  if (options.all === true) {
    detectOpts.allCwds = true;
  } else if (requestedCwd !== undefined) {
    detectOpts.cwd = requestedCwd;
  }

  const warnings: string[] = [];
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
    // After discovery, also filter on cwd extracted from session header (when
    // present). Adapters scan their cwd-mangled dir, but headers expose the
    // real cwd; respect it so users get an exact match. Lenient policy: keep
    // sessions whose header has no `cwd` field — the adapter already proved
    // their provenance by finding them under the mangled dir for `values.cwd`,
    // and hiding malformed-header sessions would silently strand them.
    refs = refs.filter((r) => r.cwd === undefined || r.cwd === requestedCwd);
  }

  let rows: Row[] = refs.map((r) => ({
    id: r.id,
    adapter: r.adapter,
    cwd: r.cwd ?? null,
    modified_at: r.modifiedAt ?? null,
    path: r.path ?? null,
  }));

  if (options.search !== undefined) {
    const matches = await Promise.all(
      rows.map(async (row) =>
        matchesSearch(row, options.search as string, options.caseSensitive === true),
      ),
    );
    rows = rows.filter((_row, index) => matches[index] === true);
  }

  const filtered = rows.filter((r) => boundedBy(r.modified_at, sinceMs, untilMs));

  filtered.sort((a, b) => {
    const aTs = a.modified_at;
    const bTs = b.modified_at;
    if (aTs !== bTs) {
      if (aTs === null) return 1;
      if (bTs === null) return -1;
      return aTs < bTs ? 1 : -1;
    }
    return a.id < b.id ? -1 : 1;
  });

  const renderedRows =
    parsedLimit.limit === undefined ? filtered : filtered.slice(0, parsedLimit.limit);
  if (parsedLimit.limit !== undefined && filtered.length > parsedLimit.limit) {
    warnings.push(
      `warning: ${filtered.length} sessions matched; showing first ${parsedLimit.limit}`,
    );
  }

  const stderr = warnings.length === 0 ? "" : `${warnings.join("\n")}\n`;
  if (options.json === true) {
    return { exitCode: 0, stdout: renderJson(renderedRows), stderr };
  }
  if (renderedRows.length === 0) {
    return { exitCode: 0, stdout: "", stderr };
  }
  return { exitCode: 0, stdout: renderText(renderedRows), stderr };
}

function renderText(rows: Row[]): string {
  return `${rows
    .map(
      (r) =>
        `${r.id.slice(0, SHORT_ID_LEN)}  ${r.adapter}  ${r.cwd ?? MISSING_TEXT}  ${
          r.modified_at ?? MISSING_TEXT
        }  ${r.path ?? MISSING_TEXT}`,
    )
    .join("\n")}\n`;
}

export function addDiscoverCommand(program: Command, writeResult: ResultWriter): void {
  addExamples(
    program
      .command("discover")
      .option("--json", "Print sessions as JSON.", false)
      .option("--all", "Discover sessions across all known cwd roots.", false)
      .option("--agent <name>", "Filter by adapter name.")
      .option("--cwd <path>", "Discover sessions for a cwd.")
      .option("--since <iso>", "Include sessions modified at or after this time.")
      .option("--until <iso>", "Include sessions modified before this time.")
      .option("--limit <n>", "Limit result rows after sorting.")
      .option("--search <query>", "Filter sessions by substring in content or metadata.")
      .option("--case-sensitive", "Make --search matching case-sensitive.", false)
      .description("Discover source-agent sessions.")
      .action(async (options: RunDiscoverOptions) => {
        writeResult(await runDiscover(options));
      }),
    ["trail discover", "trail discover --agent codex-cli --json"],
  );
}
