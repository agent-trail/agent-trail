/**
 * Shared primitives for the `trail list` and `trail discover` verbs. Both
 * verbs render row arrays with the same `--since`/`--until` time-bound
 * semantics (inclusive lower, exclusive upper) and the same `--json` output
 * shape; the per-verb Row shapes, data sources, sort policies, and text
 * renderers legitimately differ and stay in each verb's own file.
 */

/**
 * Parse a `--since` or `--until` flag value into a millisecond epoch.
 * Returns null when the value is undefined or unparseable so callers can
 * distinguish "no bound" from "invalid bound".
 */
export function parseBound(value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export type TimeBounds = {
  sinceMs: number | null;
  untilMs: number | null;
  errors: string[];
};

/**
 * Parse `--since` and `--until` together and surface unparseable values as
 * user-facing error strings. Callers exit non-zero when `errors.length > 0`.
 */
export function parseTimeBounds(since: string | undefined, until: string | undefined): TimeBounds {
  const sinceMs = parseBound(since);
  const untilMs = parseBound(until);
  const errors: string[] = [];
  if (since !== undefined && sinceMs === null) {
    errors.push(`invalid --since value: ${since}`);
  }
  if (until !== undefined && untilMs === null) {
    errors.push(`invalid --until value: ${until}`);
  }
  return { sinceMs, untilMs, errors };
}

/**
 * Time-bound predicate: returns true when the timestamp falls within
 * `[sinceMs, untilMs)` — inclusive lower, exclusive upper. A timestamp at
 * `untilMs` is treated as out-of-bounds because the comparison is `>=`, not
 * `>`. Matches the semantics list.ts and discover.ts share today. A null
 * `iso` is treated as out-of-bounds when either side is set, and a parse
 * failure is also out-of-bounds; both are conservative drops rather than
 * silent inclusions.
 */
export function boundedBy(
  iso: string | null | undefined,
  sinceMs: number | null,
  untilMs: number | null,
): boolean {
  if (sinceMs === null && untilMs === null) return true;
  if (iso === null || iso === undefined) return false;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return false;
  if (sinceMs !== null && ts < sinceMs) return false;
  if (untilMs !== null && ts >= untilMs) return false;
  return true;
}

/**
 * `--json` output shape: one JSON array, single line, trailing newline.
 * Matches the format list.ts and discover.ts already emit; downstream
 * tooling parses the line with `JSON.parse`.
 */
export function renderJson<T>(rows: T[]): string {
  return `${JSON.stringify(rows)}\n`;
}
