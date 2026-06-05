import type { AdapterSourceHealth } from "../index.ts";
import { opencodeDataDir, opencodeDbPath, opencodeStorageDir } from "./paths.ts";
import { dirExists, discoveredSummaries, pathExists } from "./storage/index.ts";

export async function inspectSourceHealth(): Promise<AdapterSourceHealth> {
  const dataDir = opencodeDataDir();
  const storageDir = opencodeStorageDir();
  const dbPath = opencodeDbPath();
  const storagePresent = await dirExists(storageDir);
  const dbPresent = await pathExists(dbPath);
  const present = storagePresent || dbPresent;
  const summaries = present ? await discoveredSummaries({ allCwds: true }) : [];
  const sessionCount = summaries.length;
  const versions = new Set(
    summaries
      .map((session) => session.version)
      .filter((version): version is string => version !== undefined),
  );
  const [sourceVersion] = versions;
  return {
    adapter: "opencode",
    path: dataDir ?? dbPath ?? null,
    present,
    readable: present,
    sessionCount,
    sourceVersion: versions.size === 1 ? (sourceVersion ?? null) : null,
    warnings: [],
  };
}
