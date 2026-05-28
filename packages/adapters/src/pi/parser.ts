import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import { resolveEntryParents } from "../parenting.ts";
import { deriveSessionUid, PI_SESSION_UID_NAMESPACE } from "../session-uid.ts";
import { findAbandonedBranchRootId } from "./divergence.ts";
import { type BuiltEntry, makePiEntryIdCtx, type PiEntryIdCtx } from "./entry-metadata.ts";
import { buildEntries } from "./envelope-mappers.ts";
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
    session_uid: deriveSessionUid(PI_SESSION_UID_NAMESPACE, id),
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
  // `buildHeader` always sets `session_uid` (deterministic v5 of the session
  // id), so the optional-on-schema field is non-null here. Narrow to satisfy
  // tsc.
  if (header.session_uid === undefined) {
    throw new Error("Pi header missing session_uid (buildHeader invariant)");
  }
  const ctx = makePiEntryIdCtx(header.session_uid);

  for (const envelope of envelopes) {
    if (envelope.type === "session") continue;
    const entries = buildEntries(
      ctx,
      envelope,
      toolCallIdToEventId,
      toolCallIdToToolKind,
      sessionVersion,
      prevModel,
    );
    // Only advance prevModel when the envelope actually emitted entries — otherwise a dropped
    // envelope (missing timestamp, missing required field, etc.) can taint a later
    // `model_change.from_model` with a model that never appears in the emitted trail.
    if (entries.length > 0) {
      if (envelope.type === "message" && envelope.message?.role === "assistant") {
        const model = stringValue(envelope.message.model);
        if (model !== undefined) prevModel = model;
      } else if (envelope.type === "model_change") {
        const next = stringValue(envelope.modelId);
        if (next !== undefined) prevModel = next;
      }
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

  const synthesizedTerminated = buildSynthesizedSessionTerminated(ctx, built, header);
  if (synthesizedTerminated !== undefined) {
    built.push({ entry: synthesizedTerminated, parentSourceId: null });
  }

  return {
    header,
    entries: resolveEntryParents(built, parentBySourceId, sourceIdToLastEntryId) as Entry[],
  };
}

// Spec §9.3 / §16.4: when the file ends with one or more `tool_call` entries
// that have no paired `tool_result` (e.g. an abandoned Pi tree branch where
// the user navigated away before the tool returned), synthesize a terminal
// `session_terminated` entry whose `open_call_ids` lists those calls.
// Validator §16.4 suppresses `unmatched_tool_call_at_eof` per id.
//
// Pairing parity with validator (spec §9.5): we apply deterministic rules A
// (explicit `for_id`) and B (`semantic.call_id` match) only. The validator
// additionally applies rule C (sequential match) before emitting the warning.
// Skipping C here means `open_call_ids` is over-inclusive — a call the
// validator would pair sequentially still appears in our list — but that is
// harmless: the validator's suppression is per-id, so listing a call already
// paired in pass C just makes the explicit ack a no-op. We deliberately do
// not duplicate sequential pairing to avoid silent drift with the validator.
function buildSynthesizedSessionTerminated(
  ctx: PiEntryIdCtx,
  built: BuiltEntry[],
  header: Header,
): Entry | undefined {
  const callIdToEntryId = new Map<string, string>();
  const toolCallEntryIds = new Set<string>();
  for (const b of built) {
    if (b.entry.type !== "tool_call") continue;
    toolCallEntryIds.add(b.entry.id);
    const semCallId = b.entry.semantic?.call_id;
    if (typeof semCallId === "string") {
      callIdToEntryId.set(semCallId, b.entry.id);
    }
  }
  if (toolCallEntryIds.size === 0) return undefined;

  const matched = new Set<string>();
  for (const b of built) {
    if (b.entry.type !== "tool_result") continue;
    const payload = b.entry.payload as { for_id?: unknown } | undefined;
    const forId = payload?.for_id;
    if (typeof forId === "string" && toolCallEntryIds.has(forId)) {
      matched.add(forId);
    }
    const semCallId = b.entry.semantic?.call_id;
    if (typeof semCallId === "string") {
      const eid = callIdToEntryId.get(semCallId);
      if (eid !== undefined) matched.add(eid);
    }
  }

  // Set preserves insertion order, so converting + filtering keeps tool_call
  // ids in file order without a third pass over `built`.
  const openCallIds = Array.from(toolCallEntryIds).filter((id) => !matched.has(id));
  if (openCallIds.length === 0) return undefined;

  // Fall back to the session header ts when no entries were emitted (e.g. a
  // truncated file with only a session record). That keeps the synthesized
  // entry within the session timeline and is spec-compliant per §9.3.
  const lastTs = built[built.length - 1]?.entry.ts ?? header.ts;
  // Synthesized session_terminated needs a globally-unique id that satisfies
  // the v0.1 ULID/UUID id regex. Deterministic v5 derived from session_uid +
  // open call ids keeps re-parses idempotent per spec §8.5.
  const synthId = ctx.deriveSynthesizedId(["session_terminated_eof", ...openCallIds]);
  const schemaVersion = header.agent.version;
  return {
    type: "session_terminated",
    id: synthId,
    ts: lastTs,
    payload: {
      reason: "eof_with_open_tool_calls",
      open_call_ids: openCallIds,
    },
    source: {
      agent: "pi",
      ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
      synthesized: true,
    },
  };
}
