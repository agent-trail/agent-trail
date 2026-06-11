import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type Adapter,
  defineAdapter,
  type RawRecord,
  type SourcePointer,
  type SourceReader,
} from "@agent-trail/adapter-kit";
import type { Entry } from "@agent-trail/types";
import { CLAUDE_CODE_ENTRY_ID_NAMESPACE } from "../session-uid.ts";
import { claudeCodeMappings, INCLUDE_SIDECHAIN } from "./mappings.ts";
import {
  ccCompactBoundaryProvenance,
  ccDropTaskPlanResults,
  ccEnvelopeRefBackfill,
  ccGitBranchMetadataSynth,
  ccModelChangeSynth,
  ccPermissionModeDelta,
  ccRequestUsageDedupe,
  ccTaskPlanDeltas,
  ccToolKindToResult,
  ccUnresolvedHookAbortFallback,
  ccVcsCommitEvents,
} from "./reconcile-rules.ts";
import { isTracerEnvelope, parseLines, stringValue } from "./source.ts";

function inheritsTimestamp(record: Raw): boolean {
  return (
    record.type === "permission-mode" ||
    record.type === "ai-title" ||
    record.type === "agent-name" ||
    record.type === "worktree-state"
  );
}

type Raw = Record<string, unknown>;
type ClaudeCodeSourcePointer = SourcePointer & { includeSidechain?: boolean };

function withInheritedTimestamps(records: Raw[], includeSidechain: boolean): Raw[] {
  const first = records.find(
    (record) => isTracerEnvelope(record, { includeSidechain }) && record.timestamp !== undefined,
  );
  let inheritedTimestamp = stringValue(first?.timestamp);
  return records.map((record) => {
    if (typeof record.timestamp === "string") inheritedTimestamp = record.timestamp;
    if (
      inheritsTimestamp(record) &&
      typeof record.timestamp !== "string" &&
      inheritedTimestamp !== undefined
    ) {
      return { ...record, timestamp: inheritedTimestamp };
    }
    return record;
  });
}

function sourceVersionOf(records: Raw[], includeSidechain: boolean): string | undefined {
  const hasVersion = (r: Raw): boolean => stringValue(r.version) !== undefined;
  let firstSession: Raw | undefined;
  for (const record of records) {
    if (!isTracerEnvelope(record, { includeSidechain }) || !hasVersion(record)) continue;
    if (record.timestamp !== undefined) return stringValue(record.version);
    if (record.sessionId !== undefined && firstSession === undefined) firstSession = record;
  }
  return stringValue(firstSession?.version);
}

class ClaudeCodeJsonlReader implements SourceReader {
  async *records(source: SourcePointer): AsyncIterable<RawRecord> {
    const text = await readFile(source.path, "utf8");
    const includeSidechain = (source as ClaudeCodeSourcePointer).includeSidechain === true;
    const records = withInheritedTimestamps(parseLines(text) as Raw[], includeSidechain);
    if (includeSidechain) {
      for (const record of records) {
        Object.defineProperty(record, INCLUDE_SIDECHAIN, { value: true });
      }
    }
    yield* records;
  }

  async schemaVersion(source: SourcePointer): Promise<string | undefined> {
    const text = await readFile(source.path, "utf8");
    const records = parseLines(text) as Raw[];
    const includeSidechain = (source as ClaudeCodeSourcePointer).includeSidechain === true;
    // The source version comes from the first tracer record that carries one
    // (preferring one with a timestamp, else one with a sessionId) — NOT the
    // first raw line, which is often a versionless record.
    return sourceVersionOf(records, includeSidechain);
  }

  async identityHash(source: SourcePointer): Promise<string> {
    const bytes = await readFile(source.path);
    return createHash("sha256").update(bytes).digest("hex");
  }
}

/**
 * Kit-based Claude Code adapter. Linear (built-in parentChain), per-record
 * source.schema_version (static mappings), agent == schema key "claude-code".
 * Synthesized model_change + permission-mode deltas + envelope_ref backfill are
 * custom rules (the assistant record is mapped, so an override would suppress it).
 */
export const claudeCodeKitAdapter: Adapter = defineAdapter({
  agent: "claude-code",
  idNamespace: CLAUDE_CODE_ENTRY_ID_NAMESPACE,
  quarantineNamespace: "claudecode",
  sourceFormatVersions: ["v1"],
  reader: new ClaudeCodeJsonlReader(),
  tsFrom: (record) => stringValue((record as Raw).timestamp) ?? "",
  mappings: claudeCodeMappings,
  reconciler: {
    toolLinking: true,
    parentChain: true, // linear; the parentUuid chain doesn't fork
    cumulativeTokens: false,
    custom: [
      ccGitBranchMetadataSynth,
      ccModelChangeSynth,
      ccRequestUsageDedupe,
      ccToolKindToResult,
      ccPermissionModeDelta,
      ccTaskPlanDeltas,
      ccDropTaskPlanResults,
      ccVcsCommitEvents,
      ccCompactBoundaryProvenance,
      ccUnresolvedHookAbortFallback,
      ccEnvelopeRefBackfill,
    ],
  },
});

/** Run the kit-based Claude Code adapter over a source file, returning entries. */
export async function parseClaudeCodeEntries(path: string, sessionUid: string): Promise<Entry[]> {
  const text = await readFile(path, "utf8");
  return parseClaudeCodeSnapshotEntries(parseLines(text) as Raw[], sessionUid);
}

export async function parseClaudeCodeSnapshotEntries(
  records: Raw[],
  sessionUid: string,
  options: { includeSidechain?: boolean } = {},
): Promise<Entry[]> {
  const includeSidechain = options.includeSidechain === true;
  let inherited = withInheritedTimestamps(records, includeSidechain);
  if (includeSidechain) {
    inherited = inherited.map((record) => ({ ...record }));
    for (const record of inherited) {
      Object.defineProperty(record, INCLUDE_SIDECHAIN, { value: true });
    }
  }
  return claudeCodeKitAdapter.parseSnapshot(
    { records: inherited, sourceVersion: sourceVersionOf(records, includeSidechain) },
    { sessionUid },
  );
}
