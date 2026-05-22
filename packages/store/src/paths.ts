import { join } from "node:path";

const DEFAULT_RELATIVE = ".local/share/trail";

export function resolveStoreRoot(override?: string): string {
  if (override !== undefined && override !== "") {
    return override;
  }
  const envOverride = process.env.AGENT_TRAIL_HOME;
  if (envOverride !== undefined && envOverride !== "") {
    return envOverride;
  }
  const home = process.env.HOME;
  if (home === undefined || home === "") {
    throw new Error(
      "Cannot resolve store root: pass opts.storeRoot, set AGENT_TRAIL_HOME, or set HOME.",
    );
  }
  return join(home, DEFAULT_RELATIVE);
}

export function objectsDir(storeRoot: string): string {
  return join(storeRoot, "objects", "sha256");
}

export function objectPath(storeRoot: string, contentHash: string): string {
  return join(objectsDir(storeRoot), `${contentHash}.trail.jsonl`);
}

export function indexDir(storeRoot: string): string {
  return join(storeRoot, "index");
}

export function indexFilePath(storeRoot: string): string {
  return join(indexDir(storeRoot), "objects.json");
}
