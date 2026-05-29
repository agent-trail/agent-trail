export type RawRecord = Record<string, unknown>;

// Points at one source artifact (a file path today; SQLite-backed readers in a
// later phase may carry a DB path under the same shape).
export interface SourcePointer {
  path: string;
}

// Storage-layer boundary. Implementations own the format/storage knowledge;
// everything above the reader (mappings, reconciler) is storage-agnostic.
export interface SourceReader {
  records(source: SourcePointer): AsyncIterable<RawRecord>;
  schemaVersion(source: SourcePointer): Promise<string | undefined>;
  identityHash(source: SourcePointer): Promise<string>;
}
