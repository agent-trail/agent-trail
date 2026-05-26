import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import { CLAUDE_CODE_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import { type BuiltEntry, baseEntry } from "./entry-metadata.ts";
import { buildEntries } from "./envelope-mappers.ts";
import { resolveEntryParents } from "./parenting.ts";
import { type CcEnvelope, isTracerEnvelope, parseLines, stringValue } from "./source.ts";

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
    session_uid: deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, firstSession.sessionId),
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
  let prevModel: string | undefined;

  for (const envelope of envelopes) {
    if (!isTracerEnvelope(envelope)) continue;
    const currentModel =
      envelope.type === "assistant" ? stringValue(envelope.message?.model) : undefined;
    const entries = buildEntries(envelope, toolUseIdToEventId, toolUseIdToToolKind);
    if (
      envelope.type === "assistant" &&
      currentModel !== undefined &&
      prevModel !== undefined &&
      currentModel !== prevModel &&
      typeof envelope.uuid === "string" &&
      entries.length > 0
    ) {
      // parent_id inherits the new assistant's parentUuid (spec §12.1: tree topology, not sequencing).
      // original_type is "assistant" because this entry is synthesized from an assistant envelope;
      // Claude Code itself never emits a model_change source record.
      const mcBase = baseEntry(
        envelope,
        // Synthesized id must be a valid ULID/UUID. The envelope.uuid +
        // suffix shape used previously produced a compound string that
        // fails the v0.1 id regex.
        crypto.randomUUID(),
        "assistant",
        undefined,
        undefined,
        { synthesized: true },
      );
      if (mcBase !== undefined) {
        built.push({
          entry: {
            ...mcBase,
            type: "model_change",
            payload: { from_model: prevModel, to_model: currentModel },
          } as Entry,
          parentUuid: envelope.parentUuid,
        });
      }
    }
    entries.forEach((entry, index) => {
      built.push({
        entry,
        parentUuid: envelope.parentUuid,
        ...(index > 0 ? { localParentId: entries[index - 1]?.id } : {}),
      });
    });
    if (typeof envelope.uuid === "string" && entries.length > 0) {
      sourceUuidToLastEntryId.set(envelope.uuid, entries[entries.length - 1]?.id ?? envelope.uuid);
      if (currentModel !== undefined) prevModel = currentModel;
    }
  }

  return {
    header,
    entries: resolveEntryParents(built, parentByUuid, sourceUuidToLastEntryId),
  };
}
