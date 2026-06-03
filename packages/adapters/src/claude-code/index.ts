import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
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
import { CLAUDE_CODE_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import { parseClaudeCodeSnapshotEntries } from "./kit.ts";
import { buildHeader } from "./parser.ts";
import { claudeCodeConfigDir, claudeCodeProjectDir, claudeCodeProjectsRoot } from "./paths.ts";
import { isObject, parseLines } from "./source.ts";

const PRODUCER = `@agent-trail/adapters-claude-code/${pkg.version}`;

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

type ForkFrom = NonNullable<Header["fork_from"]>;

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(isObject)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  return text.length > 0 ? text : undefined;
}

function textFromMessage(record: Record<string, unknown>): string | undefined {
  const message = record.message;
  if (!isObject(message)) return undefined;
  return textFromContent(message.content);
}

function subagentTask(entry: Entry): string | undefined {
  if (entry.type !== "tool_call" || entry.payload.tool !== "subagent_invoke") return undefined;
  const task = (entry.payload.args as { task?: unknown }).task;
  return typeof task === "string" && task.length > 0 ? task : undefined;
}

function childAgentKey(path: string, envelopes: Record<string, unknown>[]): string {
  const agentId = envelopes
    .map((envelope) => envelope.agentId)
    .find((value): value is string => typeof value === "string" && value.length > 0);
  return agentId ?? basename(path, ".jsonl");
}

function childPrompt(envelopes: Record<string, unknown>[]): string | undefined {
  for (const envelope of envelopes) {
    if (envelope.type !== "user") continue;
    const text = textFromMessage(envelope);
    if (text !== undefined && text.length > 0) return text;
  }
  return undefined;
}

function childBelongsToParent(envelopes: unknown[], parentSessionId: string): boolean {
  if (envelopes.length === 0) return false;
  for (const envelope of envelopes) {
    if (!isObject(envelope)) return false;
    if (envelope.isSidechain !== true) return false;
    if (envelope.sessionId !== parentSessionId) return false;
  }
  return true;
}

async function parseGroup(
  path: string,
  options: {
    forkFrom?: ForkFrom;
    childKey?: string;
    parentSessionId?: string;
    includeSidechain?: boolean;
  } = {},
): Promise<TrailSessionGroup> {
  const text = await Bun.file(path).text();
  const envelopes = parseLines(text);
  const header = buildHeader(envelopes, { includeSidechain: options.includeSidechain === true });
  if (options.childKey !== undefined && options.parentSessionId !== undefined) {
    const childId = deriveSessionUid(
      CLAUDE_CODE_SESSION_UID_NAMESPACE,
      `${options.parentSessionId}\x1f${options.childKey}`,
    );
    header.id = childId;
    header.session_uid = childId;
    header.meta = { ...header.meta, "dev.claudecode.agent_id": options.childKey };
  }
  if (options.forkFrom !== undefined) header.fork_from = options.forkFrom;
  const sessionUid = header.session_uid ?? header.id;
  const entries = await parseClaudeCodeSnapshotEntries(envelopes, sessionUid, {
    includeSidechain: options.includeSidechain === true,
  });
  return { header, entries };
}

function safeChildDir(parentPath: string): string | undefined {
  const parentDir = resolve(dirname(parentPath));
  const parentStem = basename(parentPath, ".jsonl");
  if (
    parentStem.length === 0 ||
    parentStem === "." ||
    parentStem === ".." ||
    parentStem.includes("/") ||
    parentStem.includes("\\")
  ) {
    return undefined;
  }
  const dir = resolve(parentDir, parentStem, "subagents");
  const rel = relative(parentDir, dir);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return dir;
}

async function childFiles(parentPath: string): Promise<string[]> {
  const dir = safeChildDir(parentPath);
  if (dir === undefined) return [];
  const dirStat = await lstat(dir).catch(() => undefined);
  if (dirStat === undefined || !dirStat.isDirectory() || dirStat.isSymbolicLink()) return [];
  const realParentDir = await realpath(dirname(parentPath)).catch(() => undefined);
  const realDir = await realpath(dir).catch(() => undefined);
  if (realParentDir === undefined || realDir === undefined) return [];
  const rel = relative(realParentDir, realDir);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return [];
  const names = await readdir(dir).catch(() => undefined);
  if (names === undefined) return [];
  const files: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const file = join(dir, name);
    const fileStat = await lstat(file).catch(() => undefined);
    if (fileStat === undefined || !fileStat.isFile() || fileStat.isSymbolicLink()) continue;
    files.push(file);
  }
  return files;
}

function withLinkedChildSessionIds(entries: Entry[], linked: Map<string, string>): Entry[] {
  return entries.map((entry) => {
    const childId = linked.get(entry.id);
    if (childId === undefined || entry.type !== "tool_call") return entry;
    if (entry.payload.tool !== "subagent_invoke") return entry;
    const args = isObject(entry.payload.args) ? entry.payload.args : {};
    return {
      ...entry,
      payload: { ...entry.payload, args: { ...args, session_id: childId } },
    } as Entry;
  });
}

async function directChildGroups(
  parentGroup: TrailSessionGroup,
  parentPath: string,
): Promise<TrailSessionGroup[]> {
  const files = await childFiles(parentPath);
  if (files.length === 0) return [];
  const childCandidates = await Promise.all(
    files.map(async (file) => {
      const text = await Bun.file(file)
        .text()
        .catch(() => undefined);
      if (text === undefined) return undefined;
      let envelopes: Record<string, unknown>[];
      try {
        envelopes = parseLines(text) as Record<string, unknown>[];
      } catch {
        return undefined;
      }
      if (!childBelongsToParent(envelopes, parentGroup.header.id)) return undefined;
      return {
        file,
        envelopes,
        key: childAgentKey(file, envelopes),
        prompt: childPrompt(envelopes),
      };
    }),
  );
  const candidates = childCandidates.filter((candidate) => candidate !== undefined);

  const taskCounts = new Map<string, number>();
  for (const entry of parentGroup.entries) {
    const task = subagentTask(entry);
    if (task !== undefined) taskCounts.set(task, (taskCounts.get(task) ?? 0) + 1);
  }
  const linked = new Map<string, string>();
  const groups: TrailSessionGroup[] = [];
  const usedFiles = new Set<string>();
  const usedChildIds = new Set<string>();
  for (const entry of parentGroup.entries) {
    const task = subagentTask(entry);
    if (task === undefined) continue;
    if (taskCounts.get(task) !== 1) continue;
    const matches = candidates.filter(
      (candidate) => candidate.prompt === task && !usedFiles.has(candidate.file),
    );
    if (matches.length !== 1) continue;
    const child = matches[0]!;
    const parsed = await parseGroup(child.file, {
      forkFrom: { session_id: parentGroup.header.id, entry_id: entry.id },
      childKey: child.key,
      parentSessionId: parentGroup.header.id,
      includeSidechain: true,
    }).catch(() => undefined);
    if (parsed === undefined) continue;
    if (usedChildIds.has(parsed.header.id)) continue;
    usedFiles.add(child.file);
    usedChildIds.add(parsed.header.id);
    linked.set(entry.id, parsed.header.id);
    groups.push(parsed);
  }
  parentGroup.entries = withLinkedChildSessionIds(parentGroup.entries, linked);
  return groups;
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
    const parentGroup = await parseGroup(ref.path);
    const groups = [parentGroup, ...(await directChildGroups(parentGroup, ref.path))];
    const envelope = buildTrailEnvelope({
      producer: PRODUCER,
      groups,
    });
    return { envelope, groups };
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
