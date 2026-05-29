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
    return typeof value === "object" && value !== null ? (value as RawRecord) : undefined;
  } catch {
    // Skip malformed lines defensively rather than aborting the whole source.
    return undefined;
  }
}

// Reads newline-delimited JSON sources. Yields one parsed object per line,
// skipping blank and malformed lines.
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
