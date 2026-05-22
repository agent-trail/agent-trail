import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { indexDir, indexFilePath } from "./paths.ts";

const LOCK_ANCHOR = ".lockanchor";

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

export class IndexCorruptError extends Error {
  readonly path: string;
  constructor(path: string, cause: unknown) {
    super(
      `index/objects.json at ${path} is malformed JSON: ${cause instanceof Error ? cause.message : String(cause)}. Delete the file and run rebuildIndex to recover.`,
    );
    this.name = "IndexCorruptError";
    this.path = path;
    if (cause instanceof Error) this.cause = cause;
  }
}

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
  const path = indexFilePath(storeRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyIndex();
    }
    throw error;
  }
  let parsed: IndexFile;
  try {
    parsed = JSON.parse(raw) as IndexFile;
  } catch (error) {
    throw new IndexCorruptError(path, error);
  }
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
  await withIndexLock(storeRoot, async () => {
    const index = await readIndex(storeRoot);
    index.entries[contentHash] = entry;
    await writeIndex(storeRoot, index);
  });
}

/**
 * Serialize index read-modify-write across processes via proper-lockfile.
 * Locks a sentinel file inside `index/` so the lock survives the index
 * file being deleted or rewritten. Without serialization, two concurrent
 * `registerTrail` calls would both read the same old index and one would
 * overwrite the other's entry (last writer wins).
 */
export async function withIndexLock<T>(storeRoot: string, fn: () => Promise<T>): Promise<T> {
  const dir = indexDir(storeRoot);
  await mkdir(dir, { recursive: true });
  const anchor = join(dir, LOCK_ANCHOR);
  await writeFile(anchor, "", { flag: "a" });
  const release = await lockfile.lock(anchor, {
    realpath: false,
    retries: { retries: 100, minTimeout: 5, maxTimeout: 100 },
    stale: 10_000,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}

export function emptyIndex(): IndexFile {
  return { version: INDEX_VERSION, entries: {} };
}
