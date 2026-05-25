import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../index.ts";
import { parseClaudeCodeJsonl } from "./parser.ts";
import { claudeCodeConfigDir, claudeCodeProjectDir, claudeCodeProjectsRoot } from "./paths.ts";

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readFirstJsonlLine(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await Bun.file(path).text();
  const newlineAt = text.indexOf("\n");
  const line = newlineAt === -1 ? text : text.slice(0, newlineAt);
  if (line.length === 0) return undefined;
  return JSON.parse(line) as Record<string, unknown>;
}

// Claude Code session files do not always put cwd on the first line — early
// queue-operation / hook-attachment records appear before the first user
// envelope. Scan a small head window to find the first record that carries it.
const HEAD_SCAN_BYTES = 16_384;

async function readCwdFromHead(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  const size = file.size;
  const slice = size > HEAD_SCAN_BYTES ? file.slice(0, HEAD_SCAN_BYTES) : file;
  const text = await slice.text();
  const lines = text.split("\n");
  // Drop a trailing partial line so JSON.parse never sees a truncated record.
  const safeLines = size > HEAD_SCAN_BYTES ? lines.slice(0, -1) : lines;
  for (const line of safeLines) {
    if (line.length === 0) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const cwd = record.cwd;
      if (typeof cwd === "string" && cwd.length > 0) return cwd;
    } catch {
      // Skip non-JSON lines; continue scanning.
    }
  }
  return undefined;
}

async function buildSessionRef(filePath: string, id: string): Promise<SessionRef> {
  const ref: SessionRef = { id, adapter: "claude-code", path: filePath };
  try {
    const s = await stat(filePath);
    ref.modifiedAt = new Date(s.mtimeMs).toISOString();
  } catch {
    // leave modifiedAt undefined
  }
  try {
    const cwd = await readCwdFromHead(filePath);
    if (cwd !== undefined) ref.cwd = cwd;
  } catch {
    // leave cwd undefined
  }
  return ref;
}

async function scanProjectDir(dir: string): Promise<SessionRef[]> {
  if (!(await dirExists(dir))) return [];
  const entries = await readdir(dir);
  const jsonlNames = entries.filter((name) => name.endsWith(".jsonl"));
  return Promise.all(
    jsonlNames.map((name) => buildSessionRef(join(dir, name), name.slice(0, -".jsonl".length))),
  );
}

export const claudeCodeAdapter: TrailAdapter = {
  name: "claude-code",
  async detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
    const configDir = claudeCodeConfigDir();
    if (configDir === undefined) return [];
    if (opts?.allCwds === true) {
      const root = claudeCodeProjectsRoot(configDir);
      if (!(await dirExists(root))) return [];
      const projectNames = await readdir(root);
      const perDir = await Promise.all(
        projectNames.map((name) => scanProjectDir(join(root, name))),
      );
      return perDir.flat();
    }
    const dir = claudeCodeProjectDir({ configDir, cwd: opts?.cwd ?? process.cwd() });
    return scanProjectDir(dir);
  },
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) {
      throw new Error("Claude Code adapter requires SessionRef.path");
    }
    const text = await Bun.file(ref.path).text();
    return parseClaudeCodeJsonl(text);
  },
  async isAvailable(): Promise<boolean> {
    const configDir = claudeCodeConfigDir();
    if (configDir === undefined) return false;
    return dirExists(claudeCodeProjectDir({ configDir, cwd: process.cwd() }));
  },
  async sourceVersion(): Promise<string | null> {
    const configDir = claudeCodeConfigDir();
    if (configDir === undefined) return null;
    const dir = claudeCodeProjectDir({ configDir, cwd: process.cwd() });
    if (!(await dirExists(dir))) return null;
    const entries = await readdir(dir);
    const jsonlFiles = entries.filter((name) => name.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) return null;
    const withMtime = await Promise.all(
      jsonlFiles.map(async (name) => {
        const path = join(dir, name);
        const s = await stat(path);
        return { path, mtime: s.mtimeMs };
      }),
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);
    const newest = withMtime[0];
    if (newest === undefined) return null;
    const first = await readFirstJsonlLine(newest.path);
    if (first === undefined) return null;
    return typeof first.version === "string" ? first.version : null;
  },
};
