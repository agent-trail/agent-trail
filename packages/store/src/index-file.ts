import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { indexDir, indexFilePath } from "./paths.ts";

export const INDEX_VERSION = 1;

export type IndexEntry = {
  registered_at: string;
  source_path: string | null;
};

export type IndexFile = {
  version: typeof INDEX_VERSION;
  entries: Record<string, IndexEntry>;
};

export async function readIndex(storeRoot: string): Promise<IndexFile> {
  try {
    const raw = await readFile(indexFilePath(storeRoot), "utf8");
    const parsed = JSON.parse(raw) as IndexFile;
    if (parsed.version !== INDEX_VERSION || typeof parsed.entries !== "object") {
      return emptyIndex();
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyIndex();
    }
    throw error;
  }
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
