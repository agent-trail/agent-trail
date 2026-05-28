import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { buildTrailEnvelope } from "../envelope.ts";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../index.ts";
import { readGitVcs } from "../vcs.ts";
import { parseCodexJsonl } from "./parser.ts";
import { codexSessionsDir } from "./paths.ts";

const PRODUCER = `@agent-trail/adapters-codex/${pkg.version}`;

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

const HEAD_SCAN_BYTES = 16_384;

// Codex desktop-wrapped sessions place cwd at `session_meta.payload.cwd` (line 1).
// Legacy CLI sessions (when present) place cwd at the top-level `cwd` field of
// the first header record. Scan tolerantly and return the first cwd we find.
async function readCwdFromHead(path: string): Promise<string | undefined> {
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
    const lastNewline = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    if (lastNewline < 0) return undefined;
    text = new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, lastNewline));
  }
  const lines = text.split("\n");
  const safeLines = truncated ? lines.slice(0, -1) : lines;
  for (const line of safeLines) {
    if (line.length === 0) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const payload = record.payload;
      if (payload !== null && typeof payload === "object") {
        const cwd = (payload as Record<string, unknown>).cwd;
        if (typeof cwd === "string" && cwd.length > 0) return cwd;
      }
      const topCwd = record.cwd;
      if (typeof topCwd === "string" && topCwd.length > 0) return topCwd;
    } catch {
      // Skip non-JSON lines; continue scanning.
    }
  }
  return undefined;
}

async function readSessionIdFromHead(path: string): Promise<string | undefined> {
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
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, bytesRead));
  const firstNewline = text.indexOf("\n");
  const first = firstNewline === -1 ? text : text.slice(0, firstNewline);
  if (first.length === 0) return undefined;
  try {
    const record = JSON.parse(first) as Record<string, unknown>;
    const payload = record.payload;
    if (payload !== null && typeof payload === "object") {
      const id = (payload as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) return id;
    }
    const topId = record.id;
    if (typeof topId === "string" && topId.length > 0) return topId;
  } catch {
    // ignore
  }
  return undefined;
}

async function walkRolloutFiles(root: string): Promise<string[]> {
  if (!(await dirExists(root))) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(dir, name);
      let s: Awaited<ReturnType<typeof stat>>;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        stack.push(full);
      } else if (s.isFile() && name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  return out;
}

async function buildSessionRef(filePath: string): Promise<SessionRef> {
  const id = (await readSessionIdFromHead(filePath)) ?? deriveIdFromFilename(filePath) ?? filePath;
  const ref: SessionRef = { id, adapter: "codex", path: filePath };
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

// rollout-<datetime>-<uuid>.jsonl — fall back to the trailing UUID when the
// session header is unreadable.
function deriveIdFromFilename(filePath: string): string | undefined {
  const base = filePath.replace(/^.*\//, "").replace(/\.jsonl$/, "");
  const match = base.match(/-([0-9a-f-]{36})$/i);
  return match?.[1];
}

export const codexAdapter: TrailAdapter = {
  name: "codex",
  async detectSessions(opts?: DetectOptions): Promise<SessionRef[]> {
    const sessionsDir = codexSessionsDir();
    if (sessionsDir === undefined) return [];
    const files = await walkRolloutFiles(sessionsDir);
    const refs = await Promise.all(files.map(buildSessionRef));
    if (opts?.allCwds === true) return refs;
    const filterCwd = opts?.cwd ?? process.cwd();
    return refs.filter((r) => r.cwd === undefined || r.cwd === filterCwd);
  },
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) {
      throw new Error("Codex adapter requires SessionRef.path");
    }
    const text = await Bun.file(ref.path).text();
    const { header, entries } = parseCodexJsonl(text);
    if (header.vcs === undefined && typeof header.cwd === "string") {
      const vcs = await readGitVcs(header.cwd);
      if (vcs !== undefined) header.vcs = vcs;
    }
    const envelope = buildTrailEnvelope({ producer: PRODUCER, header });
    return { envelope, header, entries };
  },
  async isAvailable(): Promise<boolean> {
    const dir = codexSessionsDir();
    if (dir === undefined) return false;
    return dirExists(dir);
  },
  async sourceVersion(): Promise<string | null> {
    return null;
  },
};
