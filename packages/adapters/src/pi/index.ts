import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../index.ts";
import { parsePiJsonl } from "./parser.ts";
import { piConfigDir, piProjectDir } from "./paths.ts";
import { versionString } from "./source.ts";

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

export const piAdapter: TrailAdapter = {
  name: "pi",
  async detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
    const configDir = piConfigDir();
    if (configDir === undefined) return [];
    const dir = piProjectDir({ configDir, cwd: opts?.cwd ?? process.cwd() });
    if (!(await dirExists(dir))) return [];
    const entries = await readdir(dir);
    return entries
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => ({
        id: name.slice(0, -".jsonl".length),
        adapter: "pi",
        path: join(dir, name),
      }));
  },
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) {
      throw new Error("Pi adapter requires SessionRef.path");
    }
    const text = await Bun.file(ref.path).text();
    return parsePiJsonl(text);
  },
  async isAvailable(): Promise<boolean> {
    const configDir = piConfigDir();
    if (configDir === undefined) return false;
    return dirExists(piProjectDir({ configDir, cwd: process.cwd() }));
  },
  async sourceVersion(): Promise<string | null> {
    const configDir = piConfigDir();
    if (configDir === undefined) return null;
    const dir = piProjectDir({ configDir, cwd: process.cwd() });
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
    return versionString(first.version) ?? null;
  },
};
