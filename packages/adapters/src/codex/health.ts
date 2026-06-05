import { readdir, stat } from "node:fs/promises";
import type { AdapterSourceHealth, SessionRef } from "../index.ts";
import { detectCodexSessions, newestCodexSourceVersion } from "./discovery.ts";
import { codexSessionsDir } from "./paths.ts";

export async function inspectSourceHealth(): Promise<AdapterSourceHealth> {
  const root = codexSessionsDir();
  if (root === undefined) {
    return {
      adapter: "codex",
      path: null,
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: ["home directory not found"],
    };
  }

  const rootStat = await stat(root).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory()) {
    return {
      adapter: "codex",
      path: root,
      present: false,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: ["source path not found"],
    };
  }

  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => error);
  if (!Array.isArray(entries)) {
    const message = entries instanceof Error ? entries.message : String(entries);
    return {
      adapter: "codex",
      path: root,
      present: true,
      readable: false,
      sessionCount: 0,
      sourceVersion: null,
      warnings: [`source path unreadable: ${message}`],
    };
  }

  const warnings: string[] = [];
  let sessions: SessionRef[] = [];
  try {
    sessions = await detectCodexSessions({ allCwds: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`session scan failed: ${message}`);
  }

  let sourceVersion: string | null = null;
  try {
    sourceVersion = await newestCodexSourceVersion();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`source version check failed: ${message}`);
  }

  return {
    adapter: "codex",
    path: root,
    present: true,
    readable: true,
    sessionCount: sessions.length,
    sourceVersion,
    warnings,
  };
}
