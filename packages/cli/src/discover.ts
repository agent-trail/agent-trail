import {
  claudeCodeAdapter,
  codexAdapter,
  type DetectOptions,
  opencodeAdapter,
  piAdapter,
  type SessionRef,
  type TrailAdapter,
} from "@agent-trail/adapters";
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

// Order matters: --agent filters by name, but the output sort tiebreak and
// JSON array order follow this list when modifiedAt is equal.
const DEFAULT_ADAPTERS: TrailAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  opencodeAdapter,
  piAdapter,
];

export async function runDiscover(options: RunDiscoverOptions = {}): Promise<RunDiscoverResult> {
  const { sinceMs, untilMs, errors: boundErrors } = parseTimeBounds(options.since, options.until);
  if (boundErrors.length > 0) {
    return { exitCode: 1, stdout: "", stderr: `${boundErrors.join("\n")}\n` };
  }

  const adapters = (options.adapters ?? DEFAULT_ADAPTERS).filter(
    (a) => options.agent === undefined || a.name === options.agent,
  );

  const detectOpts: DetectOptions = {};
  if (options.all === true) {
    detectOpts.allCwds = true;
  } else if (options.cwd !== undefined) {
    detectOpts.cwd = options.cwd;
  } else if (options.defaultCwd !== undefined) {
    detectOpts.cwd = options.defaultCwd;
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
  if (options.all !== true && options.cwd !== undefined) {
    // After discovery, also filter on cwd extracted from session header (when
    // present). Adapters scan their cwd-mangled dir, but headers expose the
    // real cwd; respect it so users get an exact match. Lenient policy: keep
    // sessions whose header has no `cwd` field — the adapter already proved
    // their provenance by finding them under the mangled dir for `values.cwd`,
    // and hiding malformed-header sessions would silently strand them.
    refs = refs.filter((r) => r.cwd === undefined || r.cwd === options.cwd);
  }

  const rows: Row[] = refs.map((r) => ({
    id: r.id,
    adapter: r.adapter,
    cwd: r.cwd ?? null,
    modified_at: r.modifiedAt ?? null,
    path: r.path ?? null,
  }));

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

  const stderr = warnings.length === 0 ? "" : `${warnings.join("\n")}\n`;
  if (options.json === true) {
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
