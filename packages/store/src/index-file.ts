import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { indexDir, indexFilePath } from "./paths.ts";

export const INDEX_VERSION = 1;

export type IndexEntry = {
  registered_at: string;
  /**
   * Absolute path of the file that was registered. `null` when the entry was
   * produced by `rebuildIndex`, which can verify hashes from on-disk objects
   * but cannot recover provenance. Consumers should treat `null` as "unknown
   * source" and rely on `content_hash` for identity.
   */
  source_path: string | null;
};

export type IndexFile = {
  version: typeof INDEX_VERSION;
  entries: Record<string, IndexEntry>;
};

export class IndexVersionError extends Error {
  readonly foundVersion: unknown;
  constructor(foundVersion: unknown) {
    super(
      `index/objects.json has unsupported version ${JSON.stringify(foundVersion)}; this binary understands version ${INDEX_VERSION}. Delete the file and run rebuildIndex, or upgrade the binary.`,
    );
    this.name = "IndexVersionError";
    this.foundVersion = foundVersion;
  }
}

/**
 * Read the on-disk index. Returns an empty index when the file does not exist
 * (first run). Throws `IndexVersionError` when the file's `version` differs
 * from `INDEX_VERSION` — silently dropping a newer-version index would lose
 * data, so failure is loud. Callers can recover by deleting the file and
 * running `rebuildIndex`.
 */
export async function readIndex(storeRoot: string): Promise<IndexFile> {
  let raw: string;
  try {
    raw = await readFile(indexFilePath(storeRoot), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyIndex();
    }
    throw error;
  }
  const parsed = JSON.parse(raw) as IndexFile;
  if (parsed.version !== INDEX_VERSION) {
    throw new IndexVersionError(parsed.version);
  }
  if (typeof parsed.entries !== "object" || parsed.entries === null) {
    return emptyIndex();
  }
  return parsed;
}

export async function writeIndex(storeRoot: string, index: IndexFile): Promise<void> {
  const target = indexFilePath(storeRoot);
  await mkdir(indexDir(storeRoot), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

export async function upsertIndexEntry(
  storeRoot: string,
  contentHash: string,
  entry: IndexEntry,
): Promise<void> {
  const index = await readIndex(storeRoot);
  index.entries[contentHash] = entry;
  await writeIndex(storeRoot, index);
}

export function emptyIndex(): IndexFile {
  return { version: INDEX_VERSION, entries: {} };
}
