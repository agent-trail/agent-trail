import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import { findAbandonedBranchRootId } from "./divergence.ts";
import type { BuiltEntry } from "./entry-metadata.ts";
import { buildEntries } from "./envelope-mappers.ts";
import { resolveEntryParents } from "./parenting.ts";
import { type PiEnvelope, parseLines, versionString } from "./source.ts";

function buildHeader(envelopes: PiEnvelope[]): Header {
  const sessionRecord = envelopes.find((env) => env.type === "session");
  if (sessionRecord === undefined) {
    throw new Error("Pi session has no header record");
  }
  const id = sessionRecord.id;
  const ts = sessionRecord.timestamp;
  if (id === undefined || ts === undefined) {
    throw new Error("Pi session header missing id or timestamp");
  }
  const version = versionString(sessionRecord.version);
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id,
    ts,
    agent: {
      name: "pi",
      ...(version !== undefined ? { version } : {}),
    },
  };
  if (sessionRecord.cwd !== undefined) header.cwd = sessionRecord.cwd;
  header.source = {
    agent: "pi",
    ...(version !== undefined ? { format_version: version } : {}),
  };
  return header;
}

function buildParentIndex(envelopes: PiEnvelope[]): Map<string, string | null> {
  const parentBySourceId = new Map<string, string | null>();
  for (const env of envelopes) {
    if (env.type === "session") continue;
    if (typeof env.id === "string") {
      parentBySourceId.set(env.id, env.parentId ?? null);
    }
  }
  return parentBySourceId;
}

// Spec §12.2: active leaf is the last event in the file. Restricting the search to envelopes that
// actually emit entries keeps unmapped trailing metadata (e.g. session_info, label, model_change)
// from poisoning the divergence walk — those envelopes don't participate in the emitted parent
// graph, so choosing one as the active leaf can collapse the shared-ancestor walk and misroot
// otherwise-valid branch summaries.
function findActiveLeafSourceId(
  envelopes: PiEnvelope[],
  sourceIdToLastEntryId: Map<string, string>,
): string | undefined {
  for (let i = envelopes.length - 1; i >= 0; i -= 1) {
    const env = envelopes[i];
    if (env === undefined) continue;
    if (typeof env.id !== "string") continue;
    if (!sourceIdToLastEntryId.has(env.id)) continue;
    return env.id;
  }
  return undefined;
}

export function parsePiJsonl(text: string): TrailFile {
  const envelopes = parseLines(text);
  const header = buildHeader(envelopes);
  const sessionVersion = versionString(envelopes.find((env) => env.type === "session")?.version);
  const parentBySourceId = buildParentIndex(envelopes);
  const toolCallIdToEventId = new Map<string, string>();
  const toolCallIdToToolKind = new Map<string, string>();
  const built: BuiltEntry[] = [];
  const sourceIdToLastEntryId = new Map<string, string>();
  const branchSummaryEnvelopeByEntryId = new Map<string, PiEnvelope>();

  for (const envelope of envelopes) {
    if (envelope.type === "session") continue;
    const entries = buildEntries(
      envelope,
      toolCallIdToEventId,
      toolCallIdToToolKind,
      sessionVersion,
    );
    entries.forEach((entry, index) => {
      built.push({
        entry,
        parentSourceId: envelope.parentId,
        ...(index > 0 ? { localParentId: entries[index - 1]?.id } : {}),
      });
    });
    if (typeof envelope.id === "string" && entries.length > 0) {
      sourceIdToLastEntryId.set(envelope.id, entries[entries.length - 1]?.id ?? envelope.id);
    }
    if (envelope.type === "branch_summary") {
      for (const entry of entries) {
        branchSummaryEnvelopeByEntryId.set(entry.id, envelope);
      }
    }
  }

  const activeLeafSourceId = findActiveLeafSourceId(envelopes, sourceIdToLastEntryId);

  // Now that sourceIdToLastEntryId is complete, refine branch_summary entries' abandoned_branch_id
  // by walking from the Pi source `fromId` up to the divergence point with the active branch.
  for (const builtEntry of built) {
    const envelope = branchSummaryEnvelopeByEntryId.get(builtEntry.entry.id);
    if (envelope === undefined) continue;
    if (typeof envelope.fromId !== "string") continue;
    const resolved = findAbandonedBranchRootId(
      envelope.fromId,
      activeLeafSourceId,
      parentBySourceId,
      sourceIdToLastEntryId,
    );
    const payload = builtEntry.entry.payload as Record<string, unknown> | undefined;
    if (payload !== undefined) {
      payload.abandoned_branch_id = resolved;
    }
  }

  return {
    header,
    entries: resolveEntryParents(built, parentBySourceId, sourceIdToLastEntryId) as Entry[],
  };
}
