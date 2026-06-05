import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { Entry, Header } from "@agent-trail/types";
import { buildTrailEnvelope } from "../envelope.ts";
import type { TrailFile, TrailSessionGroup } from "../index.ts";
import { applyParseFidelity } from "../parse-fidelity.ts";
import { CODEX_ENTRY_ID_NAMESPACE, deriveSynthesizedEntryId } from "../session-uid.ts";
import { readGitVcs } from "../vcs.ts";
import { type HeadMetadata, readMetadataFromHead, walkRolloutFiles } from "./discovery.ts";
import { parseCodexSnapshotEntries } from "./kit.ts";
import { AGENT_NAME, buildHeader, turnContextSnapshot } from "./parser.ts";
import { codexHomeDir, codexSessionsDir } from "./paths.ts";
import { isObject, sanitizeSourceRaw, stringValue, timestampToIso } from "./source.ts";

type ForkFrom = NonNullable<Header["fork_from"]>;
type ChildSessionPathIndex = Map<string, string | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseObjectRecords(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.length === 0) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (isRecord(value)) records.push(value);
    } catch {
      // Keep Codex's tolerant entry parsing behavior for malformed lines.
    }
  }
  return records;
}

// Scan for the first `turn_context` record and return its policy tuple for the
// header.meta snapshot. Returns undefined when no turn_context carries any
// policy fields.
function firstTurnContextSnapshot(
  records: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  for (const record of records) {
    if (record.type !== "turn_context") continue;
    // Match the overrides' contract: a turn_context with an unparseable
    // timestamp is skipped (it sets no baseline state and emits no events), so
    // the header snapshot must skip it too or the baseline would disagree with
    // the event stream.
    if (timestampToIso(record.timestamp) === undefined) continue;
    const payload = isObject(record.payload) ? record.payload : {};
    const snapshot = turnContextSnapshot(payload);
    // Skip a policy-less turn_context and keep scanning rather than bailing, so
    // a later record that does carry policy fields still snapshots.
    if (Object.keys(snapshot).length > 0) return snapshot;
  }
  return undefined;
}

async function parseSingleGroup(path: string, forkFrom?: ForkFrom): Promise<TrailSessionGroup> {
  const records = parseObjectRecords(await readFile(path, "utf8"));
  const firstRecord = records[0];
  if (firstRecord === undefined) {
    throw new Error("Codex session must contain a parseable JSON object header");
  }
  const header = buildHeader(firstRecord);
  if (forkFrom !== undefined) header.fork_from = forkFrom;
  // Recorded git (session_meta.git) wins; live readGitVcs is the fallback only
  // when buildHeader found no recorded VCS block.
  if (header.vcs === undefined && typeof header.cwd === "string") {
    const vcs = await readGitVcs(header.cwd);
    if (vcs !== undefined) header.vcs = vcs;
  }
  // Snapshot the initial turn_context policy tuple into header.meta so the
  // starting policy is visible without scanning the event stream; mid-session
  // changes surface as system_events (overrides.ts).
  const snapshot = firstTurnContextSnapshot(records);
  if (snapshot !== undefined) {
    header.meta = { ...(header.meta ?? {}), "dev.codex.turn_context": snapshot };
  }
  const sessionUid = header.session_uid ?? header.id;
  const entries = await parseCodexSnapshotEntries(records, sessionUid);
  const sessionIndexUpdate = sessionIndexNameUpdate(
    await readSessionIndexRow(header.id),
    sessionUid,
  );
  if (sessionIndexUpdate !== undefined) entries.push(sessionIndexUpdate);
  applyParseFidelity(header, entries);
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

export async function parseCodexTrailFile(path: string, producer: string): Promise<TrailFile> {
  const parentGroup = await parseSingleGroup(path);
  const groups = [parentGroup, ...(await directChildGroups(parentGroup, path))];
  const envelope = buildTrailEnvelope({ producer, groups });
  return { envelope, groups };
}
