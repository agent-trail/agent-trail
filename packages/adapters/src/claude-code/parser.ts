import type { Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import type { BuiltEntry } from "./entry-metadata.ts";
import { buildEntries } from "./envelope-mappers.ts";
import { resolveEntryParents } from "./parenting.ts";
import { type CcEnvelope, isTracerEnvelope, parseLines } from "./source.ts";

function buildHeader(envelopes: CcEnvelope[]): Header {
  const first = envelopes.find((env) => isTracerEnvelope(env) && env.timestamp !== undefined);
  const firstSession = envelopes.find(
    (env) => isTracerEnvelope(env) && env.sessionId !== undefined,
  );
  const firstTs = first?.timestamp;
  if (first === undefined || firstTs === undefined || firstSession?.sessionId === undefined) {
    throw new Error("Claude Code session has no parseable records");
  }
  const firstVersion = first.version ?? firstSession.version;
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id: firstSession.sessionId,
    ts: firstTs,
    agent: {
      name: "claude-code",
      ...(firstVersion !== undefined ? { version: firstVersion } : {}),
    },
  };
  if (first.cwd !== undefined) header.cwd = first.cwd;
  header.source = {
    agent: "claude-code",
    ...(firstVersion !== undefined ? { format_version: firstVersion } : {}),
  };
  return header;
}

function buildParentIndex(envelopes: CcEnvelope[]): Map<string, string | null> {
  const parentByUuid = new Map<string, string | null>();
  for (const env of envelopes) {
    if (typeof env.uuid === "string") {
      parentByUuid.set(env.uuid, env.parentUuid ?? null);
    }
  }
  return parentByUuid;
}

export function parseClaudeCodeJsonl(text: string): TrailFile {
  const envelopes = parseLines(text);
  const header = buildHeader(envelopes);
  const parentByUuid = buildParentIndex(envelopes);
  const toolUseIdToEventId = new Map<string, string>();
  const toolUseIdToToolKind = new Map<string, string>();
  const built: BuiltEntry[] = [];
  const sourceUuidToLastEntryId = new Map<string, string>();

  for (const envelope of envelopes) {
    if (!isTracerEnvelope(envelope)) continue;
    const entries = buildEntries(envelope, toolUseIdToEventId, toolUseIdToToolKind);
    entries.forEach((entry, index) => {
      built.push({
        entry,
        parentUuid: envelope.parentUuid,
        ...(index > 0 ? { localParentId: entries[index - 1]?.id } : {}),
      });
    });
    if (typeof envelope.uuid === "string" && entries.length > 0) {
      sourceUuidToLastEntryId.set(envelope.uuid, entries[entries.length - 1]?.id ?? envelope.uuid);
    }
  }

  return {
    header,
    entries: resolveEntryParents(built, parentByUuid, sourceUuidToLastEntryId),
  };
}
