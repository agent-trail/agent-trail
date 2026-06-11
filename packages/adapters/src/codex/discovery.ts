import { lstat, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DetectOptions, SessionRef } from "../index.ts";
import { canonicalizeIdentityString } from "../session-uid.ts";
import { readJsonlHead as readJsonLinesHead } from "../shared/jsonl-head.ts";
import { isRecord } from "../shared/type-guards.ts";
import { codexSessionsDir } from "./paths.ts";

export async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// 64 KiB covers observed Codex 0.128 session_meta records that embed
// base_instructions (~22 KiB), while still keeping discovery/metadata reads
// bounded. If a future shape pushes the first record past this cap,
// `readJsonLinesHead` will return a truncated tail and the wrappers below will
// skip the partial last line.
const HEAD_SCAN_BYTES = 65_536;

export type HeadMetadata = {
  id?: string;
  cwd?: string;
  threadSource?: string;
  parentThreadId?: string;
};

// Read id + cwd from the same head scan in a single open/read pass. Both
// fields live on (or near) the first record so combining halves the per-file
// I/O during `detectSessions`.
//
// Cwd surfaces in two places across observed Codex originators:
//   - `session_meta.payload.cwd` — codex-tui 0.128.x, Codex Desktop
//     0.133.x-alpha, codex_sdk_ts 0.98.x (canonical wrapped shape).
//   - top-level `cwd` field on the first record — older / hypothetical flat
//     shapes; kept as a tolerant fallback even though no real session
//     observed by the verifying contributor uses it.
// Id is only extracted from the first parseable line (session_meta carries
// the canonical session id at `payload.id`).
// See `docs/parser-source-matrix.md` Codex row for verification notes.
export async function readMetadataFromHead(path: string): Promise<HeadMetadata> {
  const { lines } = await readJsonLinesHead(path, HEAD_SCAN_BYTES);
  let id: string | undefined;
  let cwd: string | undefined;
  let threadSource: string | undefined;
  let parentThreadId: string | undefined;
  let sawFirst = false;
  for (const line of lines) {
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Skip non-JSON lines; continue scanning for cwd on later records.
      continue;
    }
    const payload = record.payload;
    if (!sawFirst) {
      sawFirst = true;
      if (payload !== null && typeof payload === "object") {
        const payloadRecord = payload as Record<string, unknown>;
        const payloadId = payloadRecord.id;
        if (typeof payloadId === "string" && payloadId.length > 0) id = payloadId;
        if (record.type === "session_meta") {
          const rawThreadSource = payloadRecord.thread_source;
          if (typeof rawThreadSource === "string" && rawThreadSource.length > 0) {
            threadSource = rawThreadSource;
          }
          const source = payloadRecord.source;
          const rawParentThreadId =
            isRecord(source) &&
            isRecord(source.subagent) &&
            isRecord(source.subagent.thread_spawn) &&
            typeof source.subagent.thread_spawn.parent_thread_id === "string"
              ? source.subagent.thread_spawn.parent_thread_id
              : undefined;
          if (rawParentThreadId !== undefined) parentThreadId = rawParentThreadId;
        }
      }
      if (id === undefined) {
        const topId = record.id;
        if (typeof topId === "string" && topId.length > 0) id = topId;
      }
    }
    if (payload !== null && typeof payload === "object") {
      const payloadRecord = payload as Record<string, unknown>;
      if (cwd === undefined) {
        const payloadCwd = payloadRecord.cwd;
        if (typeof payloadCwd === "string" && payloadCwd.length > 0) cwd = payloadCwd;
      }
    }
    if (cwd === undefined) {
      const topCwd = record.cwd;
      if (typeof topCwd === "string" && topCwd.length > 0) cwd = topCwd;
    }
    if (id !== undefined && cwd !== undefined) break;
  }
  return { id, cwd, threadSource, parentThreadId };
}

export async function readSessionVersionFromHead(path: string): Promise<string | undefined> {
  const { lines } = await readJsonLinesHead(path, HEAD_SCAN_BYTES);
  const first = lines[0];
  if (first === undefined) return undefined;
  try {
    const record = JSON.parse(first) as Record<string, unknown>;
    const payload = record.payload;
    if (payload !== null && typeof payload === "object") {
      const cliVersion = (payload as Record<string, unknown>).cli_version;
      if (typeof cliVersion === "string" && cliVersion.length > 0) return cliVersion;
      const originator = (payload as Record<string, unknown>).originator;
      if (typeof originator === "string" && originator.length > 0) return originator;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function walkRolloutFiles(root: string): Promise<string[]> {
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
      let s: Awaited<ReturnType<typeof lstat>>;
      try {
        s = await lstat(full);
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
  // Date-partitioned paths (`YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl`)
  // sort lexicographically into chronological order, giving deterministic
  // results across runs and platforms.
  out.sort();
  return out;
}

export async function buildSessionRef(filePath: string): Promise<SessionRef> {
  const meta = await readMetadataFromHead(filePath).catch(() => ({}) as HeadMetadata);
  const rawId = meta.id ?? deriveIdFromFilename(filePath) ?? filePath;
  const id = canonicalizeIdentityString(rawId);
  const ref: SessionRef = {
    id,
    adapter: "codex",
    path: filePath,
    headerStatus: meta.id !== undefined ? "header" : "filename-fallback",
  };
  try {
    const s = await stat(filePath);
    ref.modifiedAt = new Date(s.mtimeMs).toISOString();
  } catch {
    // leave modifiedAt undefined
  }
  if (meta.cwd !== undefined) ref.cwd = meta.cwd;
  return ref;
}

// rollout-<datetime>-<uuid>.jsonl — fall back to the trailing UUID when the
// session header is unreadable.
function deriveIdFromFilename(filePath: string): string | undefined {
  const base = filePath.replace(/^.*\//, "").replace(/\.jsonl$/, "");
  const match = base.match(/-([0-9a-f-]{36})$/i);
  return match?.[1];
}

export async function detectCodexSessions(opts?: DetectOptions): Promise<SessionRef[]> {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) return [];
  const files = await walkRolloutFiles(sessionsDir);
  const refs = await Promise.all(files.map(buildSessionRef));
  if (opts?.allCwds === true) return refs;
  const filterCwd = opts?.cwd ?? process.cwd();
  return refs.filter((r) => r.cwd === undefined || r.cwd === filterCwd);
}

// Report the newest session's `cli_version` (or originator string when
// version is absent). Mirrors the Pi adapter precedent — pick the file
// most recently touched in the current cwd's session tree.
export async function newestCodexSourceVersion(): Promise<string | null> {
  const dir = codexSessionsDir();
  if (dir === undefined) return null;
  if (!(await dirExists(dir))) return null;
  const files = await walkRolloutFiles(dir);
  if (files.length === 0) return null;
  const withMtime = await Promise.all(
    files.map(async (path) => {
      try {
        const s = await stat(path);
        return { path, mtime: s.mtimeMs };
      } catch {
        return { path, mtime: 0 };
      }
    }),
  );
  // Primary: newest mtime wins. Tiebreaker: lexicographically greatest path
  // because date-partitioned rollout paths sort chronologically.
  withMtime.sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.path < b.path ? 1 : a.path > b.path ? -1 : 0;
  });
  const newest = withMtime[0];
  if (newest === undefined) return null;
  return (await readSessionVersionFromHead(newest.path)) ?? null;
}
