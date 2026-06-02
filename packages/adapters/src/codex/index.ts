import { lstat, open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { Entry, Header } from "@agent-trail/types";
import pkg from "../../package.json" with { type: "json" };
import { buildTrailEnvelope } from "../envelope.ts";
import type {
  DetectOptions,
  SessionRef,
  TrailAdapter,
  TrailFile,
  TrailSessionGroup,
} from "../index.ts";
import { CODEX_ENTRY_ID_NAMESPACE, deriveSynthesizedEntryId } from "../session-uid.ts";
import { readGitVcs } from "../vcs.ts";
import { codexKitAdapter } from "./kit.ts";
import { AGENT_NAME, buildHeader } from "./parser.ts";
import { codexHomeDir, codexSessionsDir } from "./paths.ts";
import { isObject, sanitizeSourceRaw, stringValue, timestampToIso } from "./source.ts";

const PRODUCER = `@agent-trail/adapters-codex/${pkg.version}`;

async function dirExists(path: string): Promise<boolean> {
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
//     shapes; kept as a tolerant fallback even though no real session
//     observed by the verifying contributor uses it.
// Id is only extracted from the first parseable line (session_meta carries
// the canonical session id at `payload.id`).
// See `docs/parser-source-matrix.md` Codex row for verification notes.
type HeadMetadata = { id?: string; cwd?: string; threadSource?: string; parentThreadId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readMetadataFromHead(path: string): Promise<HeadMetadata> {
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

async function readFirstRecordFromHead(path: string): Promise<Record<string, unknown> | undefined> {
  const { lines } = await readJsonLinesHead(path, HEAD_SCAN_BYTES);
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (isRecord(value)) return value;
    } catch {
      // Skip malformed head lines defensively.
    }
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

type ForkFrom = NonNullable<Header["fork_from"]>;

async function parseSingleGroup(path: string, forkFrom?: ForkFrom): Promise<TrailSessionGroup> {
  const firstRecord = await readFirstRecordFromHead(path);
  if (firstRecord === undefined) {
    throw new Error("Codex session must contain a parseable JSON object header");
  }
  const header = buildHeader(firstRecord);
  if (forkFrom !== undefined) header.fork_from = forkFrom;
  if (header.vcs === undefined && typeof header.cwd === "string") {
    const vcs = await readGitVcs(header.cwd);
    if (vcs !== undefined) header.vcs = vcs;
  }
  const sessionUid = header.session_uid ?? header.id;
  const entries = await codexKitAdapter.parse({ path }, { sessionUid });
  const sessionIndexUpdate = sessionIndexNameUpdate(
    await readSessionIndexRow(header.id),
    sessionUid,
  );
  if (sessionIndexUpdate !== undefined) entries.push(sessionIndexUpdate);
  return { header, entries };
}

function isSubagentInvoke(entry: Entry): boolean {
  return entry.type === "tool_call" && entry.payload.tool === "subagent_invoke";
}

function childIdFromToolResult(entry: Entry): string | undefined {
  if (entry.type !== "tool_result") return undefined;
  const payload = entry.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const output = (payload as Record<string, unknown>).output;
  if (typeof output !== "string" || output.length === 0) return undefined;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      const agentId = (parsed as Record<string, unknown>).agent_id;
      if (typeof agentId === "string" && agentId.length > 0) return agentId;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function spawnChildCandidates(entries: Entry[]): { callEntryId: string; childId: string }[] {
  const subagentCallIds = new Set<string>();
  for (const entry of entries) {
    if (isSubagentInvoke(entry)) subagentCallIds.add(entry.id);
  }
  const out: { callEntryId: string; childId: string }[] = [];
  const seenPairs = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "tool_result") continue;
    const payload = entry.payload;
    if (typeof payload !== "object" || payload === null) continue;
    const forId = (payload as Record<string, unknown>).for_id;
    if (typeof forId !== "string" || !subagentCallIds.has(forId)) continue;
    const childId = childIdFromToolResult(entry);
    if (childId === undefined) continue;
    const key = `${forId}\0${childId}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    out.push({ callEntryId: forId, childId });
  }
  return out;
}

type ChildSessionPathIndex = Map<string, string | undefined>;

async function buildChildSessionPathIndex(
  parentPath: string,
  parentSessionId: string,
): Promise<ChildSessionPathIndex | undefined> {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) return undefined;
  const files = await walkRolloutFiles(sessionsDir);
  const index: ChildSessionPathIndex = new Map();
  for (const file of files) {
    if (file === parentPath) continue;
    const meta = await readMetadataFromHead(file).catch(() => ({}) as HeadMetadata);
    if (meta.threadSource !== "subagent" || meta.parentThreadId !== parentSessionId) continue;
    if (meta.id === undefined) continue;
    index.set(meta.id, index.has(meta.id) ? undefined : file);
  }
  return index;
}

function findUniqueSessionPathById(
  childId: string,
  childSessionPathIndex: ChildSessionPathIndex,
): string | undefined {
  return childSessionPathIndex.get(childId);
}

async function isInsideCodexSessionsDir(path: string): Promise<boolean> {
  const sessionsDir = codexSessionsDir();
  if (sessionsDir === undefined) return false;
  let root: string;
  let target: string;
  try {
    root = await realpath(sessionsDir);
    target = await realpath(path);
  } catch {
    return false;
  }
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

function withLinkedChildSessionIds(entries: Entry[], linked: Map<string, string>): Entry[] {
  return entries.map((entry) => {
    const childId = linked.get(entry.id);
    if (childId === undefined || !isSubagentInvoke(entry)) return entry;
    const args = isRecord(entry.payload.args) ? entry.payload.args : {};
    return {
      ...entry,
      payload: {
        ...entry.payload,
        args: { ...args, session_id: childId },
      },
    } as Entry;
  });
}

async function directChildGroups(
  parentGroup: TrailSessionGroup,
  parentPath: string,
): Promise<TrailSessionGroup[]> {
  if (!(await isInsideCodexSessionsDir(parentPath))) return [];
  const linked = new Map<string, string>();
  const children: TrailSessionGroup[] = [];
  const candidates = spawnChildCandidates(parentGroup.entries);
  const childSessionPathIndex = await buildChildSessionPathIndex(parentPath, parentGroup.header.id);
  if (childSessionPathIndex === undefined) return [];
  const callCounts = new Map<string, number>();
  const childCounts = new Map<string, number>();
  for (const candidate of candidates) {
    callCounts.set(candidate.callEntryId, (callCounts.get(candidate.callEntryId) ?? 0) + 1);
    childCounts.set(candidate.childId, (childCounts.get(candidate.childId) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    if (callCounts.get(candidate.callEntryId) !== 1) continue;
    if (childCounts.get(candidate.childId) !== 1) continue;
    const childPath = findUniqueSessionPathById(candidate.childId, childSessionPathIndex);
    if (childPath === undefined) continue;
    const child = await parseSingleGroup(childPath, {
      session_id: parentGroup.header.id,
      entry_id: candidate.callEntryId,
    }).catch(() => undefined);
    if (child === undefined) continue;
    linked.set(candidate.callEntryId, child.header.id);
    children.push(child);
  }
  parentGroup.entries = withLinkedChildSessionIds(parentGroup.entries, linked);
  return children;
}

function codexSessionIndexPath(): string | undefined {
  const home = codexHomeDir();
  return home === undefined ? undefined : join(home, "session_index.jsonl");
}

async function readSessionIndexRow(
  sessionId: string,
): Promise<Record<string, unknown> | undefined> {
  const path = codexSessionIndexPath();
  if (path === undefined) return undefined;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(row)) continue;
    if (stringValue(row.id) === sessionId) return row;
  }
  return undefined;
}

function sessionIndexNameUpdate(
  row: Record<string, unknown> | undefined,
  sessionUid: string,
): Entry | undefined {
  if (row === undefined) return undefined;
  const threadName = stringValue(row.thread_name);
  const trimmedThreadName = threadName?.trim();
  if (trimmedThreadName === undefined || trimmedThreadName.length === 0) return undefined;
  const ts = sessionIndexTimestampToIso(row.updated_at);
  if (ts === undefined) return undefined;
  return {
    type: "session_metadata_update",
    id: deriveSynthesizedEntryId(CODEX_ENTRY_ID_NAMESPACE, [
      sessionUid,
      "session_index",
      "thread_name",
      ts,
    ]),
    ts,
    payload: { field: "name", value: trimmedThreadName, reason: "external" },
    source: {
      agent: AGENT_NAME,
      original_type: "session_index",
      synthesized: true,
      raw: sanitizeSourceRaw(row),
    },
  };
}

function sessionIndexTimestampToIso(value: unknown): string | undefined {
  const raw = timestampToIso(value);
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
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
    const parentGroup = await parseSingleGroup(ref.path);
    const groups = [parentGroup, ...(await directChildGroups(parentGroup, ref.path))];
    const envelope = buildTrailEnvelope({ producer: PRODUCER, groups });
    return { envelope, groups };
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
