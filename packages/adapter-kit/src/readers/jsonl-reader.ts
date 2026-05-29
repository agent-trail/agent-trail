import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RawRecord, SourcePointer, SourceReader } from "./types.ts";

export interface JsonlReaderOptions {
  // Derives the source schema version from the first parsed record. Omit when
  // the source carries no version marker.
  versionFrom?: (first: RawRecord) => string | undefined;
}

function parseLine(line: string): RawRecord | undefined {
  if (line.length === 0) return undefined;
  try {
    const value = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as RawRecord)
      : undefined;
  } catch {
    // Skip malformed lines defensively rather than aborting the whole source.
    return undefined;
  }
}

// Reads newline-delimited JSON sources. Yields one parsed object per line,
// skipping blank and malformed lines.
//
// Note on malformed lines: this reader is tolerant (skips), whereas the codex
// and claude-code adapters' own parseLines throw on malformed JSON. The reader
// is not yet consumed by any adapter — the mapping pipeline that adopts it
// lands in a later phase (#146), at which point the tolerant-vs-strict choice
// is settled per adapter. Until then this divergence is inert.
//
// records() and identityHash() each read the source independently (two reads if
// both are called). Intentional for a stateless reader; revisit with a cache
// only if a real consumer profiles it as hot.
export class JsonlReader implements SourceReader {
  constructor(private readonly options: JsonlReaderOptions = {}) {}

  async *records(source: SourcePointer): AsyncIterable<RawRecord> {
    const text = await readFile(source.path, "utf8");
    for (const line of text.split("\n")) {
      const record = parseLine(line);
      if (record !== undefined) yield record;
    }
  }

  async schemaVersion(source: SourcePointer): Promise<string | undefined> {
    if (this.options.versionFrom === undefined) return undefined;
    for await (const record of this.records(source)) {
      return this.options.versionFrom(record);
    }
    return undefined;
  }

  async identityHash(source: SourcePointer): Promise<string> {
    const bytes = await readFile(source.path);
    return createHash("sha256").update(bytes).digest("hex");
  }
}
