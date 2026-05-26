import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../index.ts";
import { readGitVcs } from "../vcs.ts";
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
  // Read raw bytes via node:fs so we can decode with a fatal TextDecoder and
  // drop a trailing partial UTF-8 sequence rather than letting `.text()`
  // silently replace it. Without this guard, a multi-byte codepoint split at
  // the HEAD_SCAN_BYTES boundary could shift later newlines and surface a
  // mangled record to JSON.parse.
  const handle = await open(path, "r");
  let bytesRead: number;
  let buffer: Buffer;
  try {
    buffer = Buffer.allocUnsafe(HEAD_SCAN_BYTES);
    const result = await handle.read(buffer, 0, HEAD_SCAN_BYTES, 0);
    bytesRead = result.bytesRead;
  } finally {
    await handle.close().catch(() => {});
  }
  if (bytesRead === 0) return undefined;
  const truncated = bytesRead === HEAD_SCAN_BYTES;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
  } catch {
    // Decode failure means a multi-byte codepoint was cut at the read boundary.
    // Walk back to the last newline (which is always single-byte) and retry.
    const lastNewline = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    if (lastNewline < 0) return undefined;
    text = new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, lastNewline));
  }
  const lines = text.split("\n");
  // Drop a trailing partial line when the read hit the byte cap so JSON.parse
  // never sees a truncated record.
  const safeLines = truncated ? lines.slice(0, -1) : lines;
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
      const entries = await readdir(root, { withFileTypes: true });
      const projectDirs = entries.filter((entry) => entry.isDirectory());
      const perDir = await Promise.all(
        projectDirs.map((entry) => scanProjectDir(join(root, entry.name))),
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
    const trail = parseClaudeCodeJsonl(text);
    if (trail.header.vcs === undefined && typeof trail.header.cwd === "string") {
      const vcs = await readGitVcs(trail.header.cwd);
      if (vcs !== undefined) trail.header.vcs = vcs;
    }
    return trail;
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
