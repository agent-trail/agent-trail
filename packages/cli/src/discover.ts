import { parseArgs } from "node:util";
import {
  claudeCodeAdapter,
  type DetectOptions,
  piAdapter,
  type SessionRef,
  type TrailAdapter,
} from "@agent-trail/adapters";

export type RunDiscoverResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunDiscoverOptions = {
  adapters?: TrailAdapter[];
  cwd?: string;
};

type Row = {
  id: string;
  adapter: string;
  cwd: string | null;
  modified_at: string | null;
  path: string | null;
};

const USAGE =
  "Usage: trail discover [--json] [--all] [--agent <name>] [--cwd <path>] [--since <iso>] [--until <iso>]";
const SHORT_ID_LEN = 12;
const MISSING_TEXT = "-";

const DEFAULT_ADAPTERS: TrailAdapter[] = [claudeCodeAdapter, piAdapter];

export async function runDiscover(
  argv: string[],
  opts: RunDiscoverOptions = {},
): Promise<RunDiscoverResult> {
  const parseConfig = {
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      agent: { type: "string" },
      cwd: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
    },
    allowPositionals: false,
  } as const;

  type Values = {
    json: boolean;
    all: boolean;
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

  const adapters = (opts.adapters ?? DEFAULT_ADAPTERS).filter(
    (a) => values.agent === undefined || a.name === values.agent,
  );

  const detectOpts: DetectOptions = {};
  if (values.all) {
    detectOpts.allCwds = true;
  } else if (values.cwd !== undefined) {
    detectOpts.cwd = values.cwd;
  } else if (opts.cwd !== undefined) {
    detectOpts.cwd = opts.cwd;
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
  if (values.all === false && values.cwd !== undefined) {
    // After discovery, also filter on cwd extracted from session header (when
    // present). Adapters scan their cwd-mangled dir, but headers expose the
    // real cwd; respect it so users get an exact match.
    refs = refs.filter((r) => r.cwd === undefined || r.cwd === values.cwd);
  }

  const rows: Row[] = refs.map((r) => ({
    id: r.id,
    adapter: r.adapter,
    cwd: r.cwd ?? null,
    modified_at: r.modifiedAt ?? null,
    path: r.path ?? null,
  }));

  const filtered = rows.filter((r) => {
    if (sinceMs !== null || untilMs !== null) {
      if (r.modified_at === null) return false;
      const ts = Date.parse(r.modified_at);
      if (Number.isNaN(ts)) return false;
      if (sinceMs !== null && ts < sinceMs) return false;
      if (untilMs !== null && ts >= untilMs) return false;
    }
    return true;
  });

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
        `${r.id.slice(0, SHORT_ID_LEN)}  ${r.adapter}  ${r.cwd ?? MISSING_TEXT}  ${
          r.modified_at ?? MISSING_TEXT
        }  ${r.path ?? MISSING_TEXT}`,
    )
    .join("\n")}\n`;
}

function renderJson(rows: Row[]): string {
  return `${JSON.stringify(rows)}\n`;
}

function parseBound(value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
