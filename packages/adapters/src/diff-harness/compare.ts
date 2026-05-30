import type { Entry } from "@agent-trail/types";

/**
 * Result of comparing an old adapter's emitted entries against a new (kit-based)
 * adapter's emitted entries for the same source, under the permissive regression
 * bar of issue #146:
 *
 * - `preserved` — an old entry whose canonical signature appears in the new output.
 * - `regressions` — an old entry missing from the new output (and not an expected
 *   divergence). Any regression makes the report `blocking`.
 * - `additions` — a new entry with no matching old entry (coverage gain; non-blocking).
 * - `expectedDivergences` — an old entry intentionally not preserved (quirks-as-bugs
 *   the new adapter deliberately drops/changes; suppressed from regressions).
 */
export interface DiffReport {
  preserved: Entry[];
  regressions: Entry[];
  additions: Entry[];
  expectedDivergences: Entry[];
  blocking: boolean;
}

export interface CompareOptions {
  /**
   * Predicate over an old entry that would otherwise be a regression. When it
   * returns true the entry is routed to `expectedDivergences` instead — old
   * behavior is deliberately not preserved (e.g. Codex spinner-glyph leak, Pi
   * `BranchSummaryEntry.fromId` overwrite).
   */
  expectedDivergences?: (entry: Entry) => boolean;
}

/**
 * Stable comparison signature for an entry under the issue #146 regression bar:
 * id-bearing fields are dropped (ids are rehashed by the new adapter, so they
 * must not count as differences), every string leaf has its whitespace
 * normalized (trim + collapse internal runs), and keys are sorted recursively.
 *
 * This is a comparison signature, not a spec §7.3 content hash — it intentionally
 * discards id linkage and is permissive about whitespace.
 */
export function canonicalizeEntry(entry: Entry): string {
  const stripped = stripVolatile(entry as Record<string, unknown>);
  return stableStringify(stripped);
}

// Volatile (id-rehashed) fields, normalized away. `parent_id` and the tool-link
// references point at ids that differ between adapters; topology/linkage fidelity
// is the reconciler's own concern, out of scope for this permissive bar.
function stripVolatile(entry: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...entry };
  delete clone.id;
  delete clone.parent_id;

  const payload = clone.payload;
  if (isPlainObject(payload)) {
    const nextPayload = { ...payload };
    delete nextPayload.for_id;
    clone.payload = nextPayload;
  }

  const semantic = clone.semantic;
  if (isPlainObject(semantic)) {
    const nextSemantic = { ...semantic };
    delete nextSemantic.call_id;
    delete nextSemantic.group_id;
    clone.semantic = nextSemantic;
  }

  // `source.raw.envelope_ref` references an earlier entry's inlined envelope by
  // id (spec SourceMetadata) — same id-rehash family as for_id/parent_id, so it
  // must not count as a difference between adapters.
  const source = clone.source;
  if (isPlainObject(source) && isPlainObject(source.raw) && "envelope_ref" in source.raw) {
    const nextRaw = { ...source.raw };
    delete nextRaw.envelope_ref;
    clone.source = { ...source, raw: nextRaw };
  }

  return clone;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stableStringify(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(normalizeWhitespace(value));
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const parts = Object.entries(value)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${parts.join(",")}}`;
}

export function compareEntries(
  oldEntries: Entry[],
  newEntries: Entry[],
  options: CompareOptions = {},
): DiffReport {
  // Multiset of new-entry signatures → indices, consumed as old entries match.
  const newBySignature = new Map<string, number[]>();
  newEntries.forEach((entry, index) => {
    const sig = canonicalizeEntry(entry);
    const bucket = newBySignature.get(sig);
    if (bucket === undefined) newBySignature.set(sig, [index]);
    else bucket.push(index);
  });
  const consumedNew = new Set<number>();

  const preserved: Entry[] = [];
  const regressions: Entry[] = [];
  const expectedDivergences: Entry[] = [];

  for (const entry of oldEntries) {
    const sig = canonicalizeEntry(entry);
    const bucket = newBySignature.get(sig);
    const matchIndex = bucket?.shift();
    if (matchIndex !== undefined) {
      consumedNew.add(matchIndex);
      preserved.push(entry);
    } else if (options.expectedDivergences?.(entry) === true) {
      expectedDivergences.push(entry);
    } else {
      regressions.push(entry);
    }
  }

  const additions = newEntries.filter((_, index) => !consumedNew.has(index));

  return {
    preserved,
    regressions,
    additions,
    expectedDivergences,
    blocking: regressions.length > 0,
  };
}
