import type { JsonlRecord } from "./jsonl.ts";

/**
 * One `(session header, events*)` group inside a trail file (spec §8.6).
 * Boundaries are positional: the group extends from its header up to (but
 * excluding) the next `type:"session"` record or EOF.
 */
export type SessionGroup = {
  header: JsonlRecord;
  entries: JsonlRecord[];
  startLine: number;
  endLineExclusive: number;
};

export type SplitSessionGroupsResult = {
  /** Trail envelope at line 1, if present (spec §8.0). Excluded from every group. */
  envelope: JsonlRecord | null;
  /** Session groups in file order. May be empty for a malformed file with no session header. */
  groups: SessionGroup[];
  /** Records that appear before the first session header and after any envelope; always a graph error when non-empty. */
  preludeOrphans: JsonlRecord[];
  /** Lines that look like a `type:"session"` header but failed shape validation; surfaced as diagnostics by callers. */
  malformedHeaderLines: number[];
};

/**
 * Split a parsed trail file into its envelope (optional) plus one-or-more
 * session groups (spec §8.6). A pure structural pass: no validation, no
 * diagnostics. Callers (graph validator, hash, reconciler, redactor, store)
 * iterate the result and emit their own errors.
 *
 * A group boundary is the next `type:"session"` record after the current
 * header, or EOF.
 */
export function splitSessionGroups(records: JsonlRecord[]): SplitSessionGroupsResult {
  const envelope = records[0]?.value.type === "trail" ? (records[0] as JsonlRecord) : null;
  const startIndex = envelope === null ? 0 : 1;

  const preludeOrphans: JsonlRecord[] = [];
  const malformedHeaderLines: number[] = [];
  const groups: SessionGroup[] = [];

  let currentHeader: JsonlRecord | null = null;
  let currentEntries: JsonlRecord[] = [];

  const flush = (endLineExclusive: number) => {
    if (currentHeader === null) return;
    groups.push({
      header: currentHeader,
      entries: currentEntries,
      startLine: currentHeader.line,
      endLineExclusive,
    });
    currentHeader = null;
    currentEntries = [];
  };

  for (let i = startIndex; i < records.length; i += 1) {
    const record = records[i] as JsonlRecord;
    if (record.value.type === "session") {
      // Lenient: any `type:"session"` record opens a new group. Schema version
      // validation is the graph validator's job (reader-tolerant patch
      // versions still grouping correctly per spec §6).
      flush(record.line);
      currentHeader = record;
      if (record.value.schema_version !== "0.1.0") {
        malformedHeaderLines.push(record.line);
      }
      continue;
    }
    if (currentHeader === null) {
      preludeOrphans.push(record);
      continue;
    }
    currentEntries.push(record);
  }

  const lastLine = records.at(-1)?.line ?? 0;
  flush(lastLine + 1);

  return { envelope, groups, preludeOrphans, malformedHeaderLines };
}
