import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../index.ts";
import { parseClaudeCodeJsonl } from "./parser.ts";
import { claudeCodeProjectDir } from "./paths.ts";

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

export const claudeCodeAdapter: TrailAdapter = {
  name: "claude-code",
  async detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
    const home = process.env.HOME;
    if (home === undefined) return [];
    const dir = claudeCodeProjectDir({ home, cwd: opts?.cwd ?? process.cwd() });
    if (!(await dirExists(dir))) return [];
    const entries = await readdir(dir);
    return entries
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => ({
        id: name.slice(0, -".jsonl".length),
        adapter: "claude-code",
        path: join(dir, name),
      }));
  },
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) {
      throw new Error("Claude Code adapter requires SessionRef.path");
    }
    const text = await Bun.file(ref.path).text();
    return parseClaudeCodeJsonl(text);
  },
  async isAvailable(): Promise<boolean> {
    const home = process.env.HOME;
    if (home === undefined) return false;
    return dirExists(claudeCodeProjectDir({ home, cwd: process.cwd() }));
  },
  async sourceVersion(): Promise<string | null> {
    const home = process.env.HOME;
    if (home === undefined) return null;
    const dir = claudeCodeProjectDir({ home, cwd: process.cwd() });
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
