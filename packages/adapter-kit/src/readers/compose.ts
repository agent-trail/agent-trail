import { createHash } from "node:crypto";
import type { RawRecord, SourcePointer, SourceReader } from "./types.ts";

async function combinedHash(readers: SourceReader[], source: SourcePointer): Promise<string> {
  const hashes = await Promise.all(readers.map((r) => r.identityHash(source)));
  return createHash("sha256").update(hashes.join("\n")).digest("hex");
}

function firstVersion(readers: SourceReader[], source: SourcePointer): Promise<string | undefined> {
  const first = readers[0];
  return first === undefined ? Promise.resolve(undefined) : first.schemaVersion(source);
}

// Drains readers sequentially: all records from the first, then the second, etc.
// Use when temporal interleaving between sources does not matter.
export function chainReaders(readers: SourceReader[]): SourceReader {
  return {
    async *records(source: SourcePointer): AsyncIterable<RawRecord> {
      for (const reader of readers) yield* reader.records(source);
    },
    schemaVersion: (source) => firstVersion(readers, source),
    identityHash: (source) => combinedHash(readers, source),
  };
}

export interface MergeByTimestampOptions {
  // Extracts a sortable numeric timestamp from a record. Defaults to a numeric
  // `record.timestamp` (number or numeric string). Records without a usable
  // timestamp sort before all timestamped records, in reader order.
  timestampFrom?: (record: RawRecord) => number | undefined;
}

function defaultTimestamp(record: RawRecord): number | undefined {
  const value = record.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// Interleaves records from all readers ordered by timestamp ascending. The sort
// is stable, so records with equal (or absent) timestamps keep reader order.
// Only sound when sources emit comparable timestamps.
export function mergeByTimestamp(
  readers: SourceReader[],
  options: MergeByTimestampOptions = {},
): SourceReader {
  const tsOf = options.timestampFrom ?? defaultTimestamp;
  return {
    async *records(source: SourcePointer): AsyncIterable<RawRecord> {
      const collected: RawRecord[] = [];
      for (const reader of readers) {
        for await (const record of reader.records(source)) collected.push(record);
      }
      const keyed = collected.map((record, index) => ({
        record,
        index,
        ts: tsOf(record),
      }));
      keyed.sort((a, b) => {
        const at = a.ts ?? Number.NEGATIVE_INFINITY;
        const bt = b.ts ?? Number.NEGATIVE_INFINITY;
        if (at !== bt) return at - bt;
        return a.index - b.index;
      });
      for (const entry of keyed) yield entry.record;
    },
    schemaVersion: (source) => firstVersion(readers, source),
    identityHash: (source) => combinedHash(readers, source),
  };
}
