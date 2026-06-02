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
  ccDropTaskPlanResults,
  ccEnvelopeRefBackfill,
  ccModelChangeSynth,
  ccPermissionModeDelta,
  ccTaskPlanDeltas,
  ccToolKindToResult,
} from "./reconcile-rules.ts";
import { isTracerEnvelope, parseLines, stringValue } from "./source.ts";

type Raw = Record<string, unknown>;
type ClaudeCodeSourcePointer = SourcePointer & { includeSidechain?: boolean };

function withInheritedPermissionTimestamps(records: Raw[], includeSidechain: boolean): Raw[] {
  const first = records.find(
    (record) => isTracerEnvelope(record, { includeSidechain }) && record.timestamp !== undefined,
  );
  let inheritedTimestamp = stringValue(first?.timestamp);
  return records.map((record) => {
    if (typeof record.timestamp === "string") inheritedTimestamp = record.timestamp;
    if (
      record.type === "permission-mode" &&
      typeof record.timestamp !== "string" &&
      inheritedTimestamp !== undefined
    ) {
      return { ...record, timestamp: inheritedTimestamp };
    }
    return record;
  });
}

class ClaudeCodeJsonlReader implements SourceReader {
  async *records(source: SourcePointer): AsyncIterable<RawRecord> {
    const text = await readFile(source.path, "utf8");
    const includeSidechain = (source as ClaudeCodeSourcePointer).includeSidechain === true;
    const records = withInheritedPermissionTimestamps(parseLines(text) as Raw[], includeSidechain);
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
    const hasVersion = (r: Raw): boolean => stringValue(r.version) !== undefined;
    const first = records.find(
      (r) =>
        isTracerEnvelope(r, { includeSidechain }) && r.timestamp !== undefined && hasVersion(r),
    );
    const firstSession = records.find(
      (r) =>
        isTracerEnvelope(r, { includeSidechain }) && r.sessionId !== undefined && hasVersion(r),
    );
    return stringValue(first?.version) ?? stringValue(firstSession?.version);
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
      ccModelChangeSynth,
      ccToolKindToResult,
      ccPermissionModeDelta,
      ccTaskPlanDeltas,
      ccDropTaskPlanResults,
      ccEnvelopeRefBackfill,
    ],
  },
});

/** Run the kit-based Claude Code adapter over a source file, returning entries. */
export async function parseClaudeCodeEntries(path: string, sessionUid: string): Promise<Entry[]> {
  return claudeCodeKitAdapter.parse({ path }, { sessionUid });
}
