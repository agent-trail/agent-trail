import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { emptyIndex, withIndexLock, writeIndex } from "./index-file.ts";
import { writerStrictObjectIndexPolicy } from "./object-index-policy.ts";
import { objectsDir, resolveStoreRoot } from "./paths.ts";

const OBJECT_NAME = /^([0-9a-f]{64})\.trail\.jsonl$/;

export type RebuildIndexOptions = {
  storeRoot?: string;
};

export type RebuildIndexResult = {
  entries: number;
};

export async function rebuildIndex(opts: RebuildIndexOptions = {}): Promise<RebuildIndexResult> {
  const storeRoot = resolveStoreRoot(opts.storeRoot);
  const dir = objectsDir(storeRoot);

  const index = emptyIndex();

  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      names = [];
    } else {
      throw error;
    }
  }

  for (const name of names) {
    const match = OBJECT_NAME.exec(name);
    if (match === null) {
      continue;
    }
    const filenameHash = match[1] as string;
    const path = join(dir, name);

    // Skip files whose hash cannot be verified (parse error, mismatch, etc.)
    // so one corrupt object does not abort the whole rebuild.
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    const eligible = await writerStrictObjectIndexPolicy(raw);
    const row =
      eligible.status === "valid"
        ? eligible.policy.rows.find((candidate) => candidate.contentHash === filenameHash)
        : undefined;
    if (row === undefined) {
      continue;
    }

    const info = await stat(path);
    index.entries[filenameHash] = {
      registered_at: info.mtime.toISOString(),
      source_path: null,
      session_uid: row.session_uid,
      kind: row.kind,
    };
  }

  await withIndexLock(storeRoot, () => writeIndex(storeRoot, index));
  return { entries: Object.keys(index.entries).length };
}
