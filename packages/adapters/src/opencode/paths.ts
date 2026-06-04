import { join } from "node:path";

export function opencodeDataDir(): string | undefined {
  if (process.env.OPENCODE_DATA_DIR !== undefined && process.env.OPENCODE_DATA_DIR.length > 0) {
    return process.env.OPENCODE_DATA_DIR;
  }
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome !== undefined && xdgDataHome.length > 0) {
    return join(xdgDataHome, "opencode");
  }
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home === undefined || home.length === 0) return undefined;
  return join(home, ".local", "share", "opencode");
}

export function opencodeDbPath(): string | undefined {
  if (process.env.OPENCODE_DB !== undefined && process.env.OPENCODE_DB.length > 0) {
    return process.env.OPENCODE_DB;
  }
  const dir = opencodeDataDir();
  return dir === undefined ? undefined : join(dir, "opencode.db");
}

export function opencodeStorageDir(): string | undefined {
  const dir = opencodeDataDir();
  return dir === undefined ? undefined : join(dir, "storage");
}
