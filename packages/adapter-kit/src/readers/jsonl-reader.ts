import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { RawRecord, SourcePointer, SourceReader } from "./types.ts";

export interface JsonlReaderOptions {
  // Derives the source schema version from the first parsed record. Omit when
  // the source carries no version marker.
  versionFrom?: (first: RawRecord) => string | undefined;
  // Tolerant mode skips malformed / non-object lines. Strict mode throws so
  // adapters with strict source contracts do not silently omit source records.
  mode?: "tolerant" | "strict";
}

function parseLine(
  line: string,
  lineNumber: number,
  mode: "tolerant" | "strict",
): RawRecord | undefined {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmedLine);
  } catch {
    if (mode === "strict") {
      throw new Error(`JsonlReader: malformed JSON on line ${lineNumber}`);
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as RawRecord;
  }
  if (mode === "strict") {
    throw new Error(`JsonlReader: expected JSON object on line ${lineNumber}`);
  }
  return undefined;
}

// Reads newline-delimited JSON sources. In tolerant mode, yields one parsed
// object per line while skipping blank, malformed, and non-object lines. In
// strict mode, blank lines are still ignored but malformed / non-object lines
// throw. Adapter owners pick the mode at their source trust boundary.
//
// records() and identityHash() each read the source independently (two reads if
// both are called). Intentional for a stateless reader; revisit with a cache
// only if a real consumer profiles it as hot.
export class JsonlReader implements SourceReader {
  constructor(private readonly options: JsonlReaderOptions = {}) {}

  async *records(source: SourcePointer): AsyncIterable<RawRecord> {
    const text = await readFile(source.path, "utf8");
    const mode = this.options.mode ?? "tolerant";
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const record = parseLine(lines[i] ?? "", i + 1, mode);
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
