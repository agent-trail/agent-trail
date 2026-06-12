import { computeContentHash, type JsonlRecord, splitSessionGroups } from "@agent-trail/core";
import { addMutationCount } from "./mutation-accounting.ts";
import { maskSample } from "./rules.ts";
import type { RedactionSummary } from "./types.ts";

function recordStrippedRemoteUrl(
  summary: RedactionSummary,
  maxSamples: number,
  before: string,
  location: string,
): void {
  summary.counts.vcs_remote_url = (summary.counts.vcs_remote_url ?? 0) + 1;
  if (summary.samples.length < maxSamples) {
    summary.samples.push({
      patternId: "vcs_remote_url",
      location,
      before: maskSample(before),
      after: "[STRIPPED]",
    });
  }
}

// Removes vcs.remote_url from the header. Default-on per spec §15 / PRD §8.6
// step 7 because the field reveals repository identity (potentially private).
// Records the strip in the summary so share-time previews surface it.
export function stripVcsRemoteUrl(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "session" && value.type !== "trail") continue;
    const vcs = value.vcs as Record<string, unknown> | undefined;
    if (vcs === undefined || typeof vcs.remote_url !== "string") continue;
    const before = vcs.remote_url;
    delete vcs.remote_url;
    recordStrippedRemoteUrl(summary, maxSamples, before, `records[${index}].vcs.remote_url`);
  }
}

export function stripVcsCommitRepo(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
  redactionCounts: Map<number, number>,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "system_event") continue;
    const payload = value.payload as Record<string, unknown> | undefined;
    if (payload?.kind !== "vcs_commit") continue;
    const data = payload.data as Record<string, unknown> | undefined;
    if (typeof data?.repo !== "string") continue;
    const before = data.repo;
    delete data.repo;
    addMutationCount(redactionCounts, index, 1);
    recordStrippedRemoteUrl(summary, maxSamples, before, `records[${index}].payload.data.repo`);
  }
}

export function resetContentHashes(records: JsonlRecord[]): void {
  for (const record of records) {
    const value = record.value as Record<string, unknown>;
    if (
      (value.type === "session" || value.type === "trail") &&
      typeof value.content_hash === "string"
    ) {
      value.content_hash = "<pending>";
    }
  }
}

export function normalizeLineageHashes(records: JsonlRecord[]): void {
  const split = splitSessionGroups(records);
  const groups = split.groups.map((group, index) => ({
    group,
    index,
    value: group.header.value,
  }));
  const groupById = uniqueGroupsById(groups);
  const groupBySegmentKey = uniqueGroupsBySegmentKey(groups);
  const hashByGroupIndex = new Map<number, string>();
  const visiting = new Set<number>();

  const hashForGroup = (groupIndex: number): string | undefined => {
    if (hashByGroupIndex.has(groupIndex)) return hashByGroupIndex.get(groupIndex);
    if (visiting.has(groupIndex)) return undefined;
    const entry = groups[groupIndex];
    if (entry === undefined) return undefined;

    visiting.add(groupIndex);
    rewriteForkFrom(entry.value, groupById, hashForGroup);
    rewriteSegmentPrevHash(entry.value, groupBySegmentKey, hashForGroup);
    visiting.delete(groupIndex);

    const digest = computeContentHash(records, { groupIndex });
    hashByGroupIndex.set(groupIndex, digest);
    return digest;
  };

  for (const entry of groups) {
    hashForGroup(entry.index);
  }

  if (split.envelope !== null) {
    rewriteForkFrom(split.envelope.value, groupById, hashForGroup);
  }
}

type LineageGroup = {
  index: number;
  value: Record<string, unknown>;
};

function uniqueGroupsById(groups: LineageGroup[]): Map<string, LineageGroup> {
  const counts = new Map<string, number>();
  for (const { value } of groups) {
    const id = value.id;
    if (typeof id === "string") counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out = new Map<string, LineageGroup>();
  for (const group of groups) {
    const id = group.value.id;
    if (typeof id === "string" && counts.get(id) === 1) out.set(id, group);
  }
  return out;
}

function uniqueGroupsBySegmentKey(groups: LineageGroup[]): Map<string, LineageGroup> {
  const counts = new Map<string, number>();
  for (const { value } of groups) {
    const key = segmentKeyForValue(value);
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out = new Map<string, LineageGroup>();
  for (const group of groups) {
    const key = segmentKeyForValue(group.value);
    if (key !== undefined && counts.get(key) === 1) out.set(key, group);
  }
  return out;
}

function rewriteForkFrom(
  value: Record<string, unknown>,
  groupById: Map<string, LineageGroup>,
  hashForGroup: (groupIndex: number) => string | undefined,
): void {
  const forkFrom = value.fork_from;
  if (typeof forkFrom !== "object" || forkFrom === null) return;
  const forkFromRecord = forkFrom as Record<string, unknown>;
  const sessionId = forkFromRecord.session_id;
  if (typeof sessionId === "string") {
    const targetGroup = groupById.get(sessionId);
    const targetHash = targetGroup === undefined ? undefined : hashForGroup(targetGroup.index);
    if (targetHash !== undefined) {
      forkFromRecord.content_hash = targetHash;
      return;
    }
  }
  delete forkFromRecord.content_hash;
}

function rewriteSegmentPrevHash(
  value: Record<string, unknown>,
  groupBySegmentKey: Map<string, LineageGroup>,
  hashForGroup: (groupIndex: number) => string | undefined,
): void {
  const sessionUid = value.session_uid;
  if (typeof sessionUid !== "string") return;
  const segment = value.segment;
  if (typeof segment !== "object" || segment === null) return;
  const segmentRecord = segment as Record<string, unknown>;
  const seq = segmentSeq(segmentRecord);
  if (seq < 2) return;
  const prevGroup = groupBySegmentKey.get(segmentKey(sessionUid, seq - 1));
  const prevHash = prevGroup === undefined ? undefined : hashForGroup(prevGroup.index);
  segmentRecord.prev_content_hash = prevHash ?? null;
}

function segmentKeyForValue(value: Record<string, unknown>): string | undefined {
  const sessionUid = value.session_uid;
  if (typeof sessionUid !== "string") return undefined;
  return segmentKey(sessionUid, segmentSeq(value.segment));
}

function segmentSeq(segment: unknown): number {
  if (typeof segment !== "object" || segment === null) return 1;
  const seq = (segment as { seq?: unknown }).seq;
  return typeof seq === "number" && Number.isInteger(seq) ? seq : 1;
}

function segmentKey(sessionUid: string, seq: number): string {
  return `${sessionUid}\0${seq}`;
}

export function syncRawRecords(records: JsonlRecord[]): void {
  for (const record of records) {
    record.raw = JSON.stringify(record.value);
  }
}
