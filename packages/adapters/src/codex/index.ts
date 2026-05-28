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

// 16 KiB comfortably covers the `session_meta` first record across every
// observed Codex originator (codex-tui 0.128.x ~600 B; Codex Desktop
// 0.133.x-alpha ~900 B; codex_sdk_ts 0.98.x ~700 B). If a future shape
// pushes the header past 16 KiB, `readJsonLinesHead` will return a
// truncated tail and the wrappers below will skip the partial last line.
const HEAD_SCAN_BYTES = 16_384;

type JsonLineHead = {
  lines: string[];
  truncated: boolean;
};

// Read the first `maxBytes` of `path` and return the safely-parseable
// newline-delimited lines. Decode UTF-8 *first* (with `fatal: false`) then
// trim at the last newline in the decoded string — using byte offsets on a
// partial UTF-8 buffer can split a multi-byte codepoint and corrupt the tail.
// When the read hits `maxBytes`, the last line is treated as potentially
// truncated and dropped.
async function readJsonLinesHead(path: string, maxBytes: number): Promise<JsonLineHead> {
  const handle = await open(path, "r");
  let bytesRead: number;
  let buffer: Buffer;
  try {
    buffer = Buffer.allocUnsafe(maxBytes);
    const result = await handle.read(buffer, 0, maxBytes, 0);
    bytesRead = result.bytesRead;
  } finally {
    await handle.close().catch(() => {});
  }
  if (bytesRead === 0) return { lines: [], truncated: false };
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer.subarray(0, bytesRead));
  const truncated = bytesRead === maxBytes;
  // When truncated, drop the trailing partial line by trimming to the last
  // newline; when not truncated, accept the final line as a complete record.
  let safeText = text;
  if (truncated) {
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) return { lines: [], truncated: true };
    safeText = text.slice(0, lastNewline);
  }
  const lines = safeText.split("\n").filter((line) => line.length > 0);
  return { lines, truncated };
}

// Read id + cwd from the same head scan in a single open/read pass. Both
// fields live on (or near) the first record so combining halves the per-file
// I/O during `detectSessions`.
//
// Cwd surfaces in two places across observed Codex originators:
//   - `session_meta.payload.cwd` — codex-tui 0.128.x, Codex Desktop
//     0.133.x-alpha, codex_sdk_ts 0.98.x (canonical wrapped shape).
//   - top-level `cwd` field on the first record — older / hypothetical flat
//     shapes; kept as a tolerant fallback even though PR1's verifying
//     contributor never observed it in real sessions.
// Id is only extracted from the first parseable line (session_meta carries
// the canonical session id at `payload.id`).
// See `docs/parser-source-matrix.md` Codex row for verification notes.
type HeadMetadata = { id?: string; cwd?: string };

async function readMetadataFromHead(path: string): Promise<HeadMetadata> {
  const { lines } = await readJsonLinesHead(path, HEAD_SCAN_BYTES);
  let id: string | undefined;
  let cwd: string | undefined;
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
        const payloadId = (payload as Record<string, unknown>).id;
        if (typeof payloadId === "string" && payloadId.length > 0) id = payloadId;
      }
      if (id === undefined) {
        const topId = record.id;
        if (typeof topId === "string" && topId.length > 0) id = topId;
      }
    }
    if (cwd === undefined && payload !== null && typeof payload === "object") {
      const payloadCwd = (payload as Record<string, unknown>).cwd;
      if (typeof payloadCwd === "string" && payloadCwd.length > 0) cwd = payloadCwd;
    }
    if (cwd === undefined) {
      const topCwd = record.cwd;
      if (typeof topCwd === "string" && topCwd.length > 0) cwd = topCwd;
    }
    if (id !== undefined && cwd !== undefined) break;
  }
  return { id, cwd };
}

async function readSessionVersionFromHead(path: string): Promise<string | undefined> {
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
  // Date-partitioned paths (`YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl`)
  // sort lexicographically into chronological order, giving deterministic
  // results across runs and platforms.
  out.sort();
  return out;
}

async function buildSessionRef(filePath: string): Promise<SessionRef> {
  const meta = await readMetadataFromHead(filePath).catch(() => ({}) as HeadMetadata);
  const id = meta.id ?? deriveIdFromFilename(filePath) ?? filePath;
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
  // Report the newest session's `cli_version` (or originator string when
  // version is absent). Mirrors the Pi adapter precedent — pick the file
  // most recently touched in the current cwd's session tree.
  async sourceVersion(): Promise<string | null> {
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
    // Primary: newest mtime wins. Tiebreaker: lexicographically greatest
    // path (date-partitioned `YYYY/MM/DD/rollout-<datetime>-<uuid>.jsonl`
    // sorts chronologically). The tiebreaker matters because fast loops
    // that seed sessions back-to-back on Linux can land identical mtimes,
    // and a stable mtime-only sort would then pick the older file.
    withMtime.sort((a, b) => {
      if (b.mtime !== a.mtime) return b.mtime - a.mtime;
      return a.path < b.path ? 1 : a.path > b.path ? -1 : 0;
    });
    const newest = withMtime[0];
    if (newest === undefined) return null;
    return (await readSessionVersionFromHead(newest.path)) ?? null;
  },
};
