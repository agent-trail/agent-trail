import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import { findAbandonedBranchRootId } from "./divergence.ts";
import type { BuiltEntry } from "./entry-metadata.ts";
import { buildEntries } from "./envelope-mappers.ts";
import { resolveEntryParents } from "./parenting.ts";
import {
  type PiEnvelope,
  parseLines,
  stringValue,
  timestampToIso,
  versionString,
} from "./source.ts";

function buildHeader(envelopes: PiEnvelope[]): Header {
  const sessionRecord = envelopes.find((env) => env.type === "session");
  if (sessionRecord === undefined) {
    throw new Error("Pi session has no header record");
  }
  const id = sessionRecord.id;
  const ts = timestampToIso(sessionRecord.timestamp);
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

export function parsePiJsonl(text: string): TrailFile {
  const envelopes = parseLines(text);
  const header = buildHeader(envelopes);
  const sessionVersion = versionString(envelopes.find((env) => env.type === "session")?.version);
  const parentBySourceId = buildParentIndex(envelopes);
  const toolCallIdToEventId = new Map<string, string>();
  const toolCallIdToToolKind = new Map<string, string>();
  const built: BuiltEntry[] = [];
  // `sourceIdToLastEntryId` powers parent resolution (the *last* emitted entry of an envelope is
  // the entry subsequent envelopes should chain off of). `sourceIdToFirstEntryId` is used by the
  // branch-summary divergence walk, where spec §9.3 "root of abandoned branch" means the
  // top-most entry on the abandoned side — i.e. the *first* entry of the divergence envelope.
  const sourceIdToLastEntryId = new Map<string, string>();
  const sourceIdToFirstEntryId = new Map<string, string>();
  const branchSummaryEnvelopeByEntryId = new Map<string, PiEnvelope>();
  let prevModel: string | undefined;

  for (const envelope of envelopes) {
    if (envelope.type === "session") continue;
    const entries = buildEntries(
      envelope,
      toolCallIdToEventId,
      toolCallIdToToolKind,
      sessionVersion,
      prevModel,
    );
    if (envelope.type === "message" && envelope.message?.role === "assistant") {
      const model = stringValue(envelope.message.model);
      if (model !== undefined) prevModel = model;
    } else if (envelope.type === "model_change") {
      const next = stringValue(envelope.modelId);
      if (next !== undefined) prevModel = next;
    }
    entries.forEach((entry, index) => {
      built.push({
        entry,
        parentSourceId: envelope.parentId,
        ...(index > 0 ? { localParentId: entries[index - 1]?.id } : {}),
      });
    });
    if (typeof envelope.id === "string" && entries.length > 0) {
      sourceIdToLastEntryId.set(envelope.id, entries[entries.length - 1]?.id ?? envelope.id);
      sourceIdToFirstEntryId.set(envelope.id, entries[0]?.id ?? envelope.id);
    }
    if (envelope.type === "branch_summary") {
      for (const entry of entries) {
        branchSummaryEnvelopeByEntryId.set(entry.id, envelope);
      }
    }
  }

  // Refine branch_summary entries' abandoned_branch_id by walking from the Pi source `fromId` up
  // to the divergence point with the active branch. Active leaf is resolved *per summary* against
  // the arrival point at write-time (`envelope.parentId`) — not a single file-global leaf —
  // because sessions with multiple `/tree` navigations have multiple active branches over time,
  // and reusing the final file leaf would reinterpret earlier summaries through a later branch's
  // state.
  for (const builtEntry of built) {
    const envelope = branchSummaryEnvelopeByEntryId.get(builtEntry.entry.id);
    if (envelope === undefined) continue;
    if (typeof envelope.fromId !== "string") continue;
    const activeLeafSourceId =
      typeof envelope.parentId === "string" ? envelope.parentId : undefined;
    const resolved = findAbandonedBranchRootId(
      envelope.fromId,
      activeLeafSourceId,
      parentBySourceId,
      sourceIdToFirstEntryId,
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
