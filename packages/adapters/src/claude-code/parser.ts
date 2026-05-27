import type { Entry, Header } from "@agent-trail/types";
import type { TrailFile } from "../index.ts";
import { resolveEntryParents } from "../parenting.ts";
import { CLAUDE_CODE_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import type { WorktreeInfo } from "../vcs.ts";
import { type BuiltEntry, baseEntry } from "./entry-metadata.ts";
import { buildEntries, mapPermissionModeEnvelope } from "./envelope-mappers.ts";
import { type CcEnvelope, isTracerEnvelope, parseLines, stringValue } from "./source.ts";

export type ClaudeCodeMetadataHints = {
  envelopeName?: string;
  envelopeMeta?: Record<string, unknown>;
  worktree?: WorktreeInfo;
  worktreeBranch?: string;
  worktreeHeadCommit?: string;
};

// Pre-scan extracts session-level metadata that does not belong on the timeline:
// `ai-title` / `agent-name` populate `envelope.name` (and a meta breadcrumb);
// `worktree-state` enriches `header.vcs` with branch + worktree subobject.
// These envelope types stay out of `isTracerEnvelope` because they are session
// metadata, not events.
export function extractMetadataHints(envelopes: CcEnvelope[]): ClaudeCodeMetadataHints {
  const hints: ClaudeCodeMetadataHints = {};
  const meta: Record<string, unknown> = {};

  const aiTitleEnv = envelopes.find((env) => env.type === "ai-title");
  const agentNameEnv = envelopes.find((env) => env.type === "agent-name");
  const worktreeEnv = envelopes.find((env) => env.type === "worktree-state");

  const aiTitle = stringValue(aiTitleEnv?.aiTitle);
  const agentName = stringValue(agentNameEnv?.agentName);
  if (aiTitle !== undefined) meta["x-claudecode/ai_title"] = aiTitle;
  if (agentName !== undefined) meta["x-claudecode/agent_name"] = agentName;
  hints.envelopeName = aiTitle ?? agentName;

  if (worktreeEnv !== undefined) {
    const ws = worktreeEnv.worktreeSession;
    if (ws !== null && typeof ws === "object") {
      const sess = ws as Record<string, unknown>;
      const name = stringValue(sess.worktreeName);
      const path = stringValue(sess.worktreePath);
      if (name !== undefined && path !== undefined) {
        const worktree: WorktreeInfo = { name, path };
        const originalCwd = stringValue(sess.originalCwd);
        const originalBranch = stringValue(sess.originalBranch);
        const originalHeadCommit = stringValue(sess.originalHeadCommit);
        if (originalCwd !== undefined) worktree.original_cwd = originalCwd;
        if (originalBranch !== undefined) worktree.original_branch = originalBranch;
        if (originalHeadCommit !== undefined && /^[a-f0-9]{7,64}$/.test(originalHeadCommit)) {
          worktree.original_head_commit = originalHeadCommit;
        }
        hints.worktree = worktree;
      }
      const branch = stringValue(sess.worktreeBranch);
      if (branch !== undefined) hints.worktreeBranch = branch;
      // Claude Code's worktree-state envelope carries `originalHeadCommit`
      // (the fork-point commit). The current HEAD may have moved since, so
      // `vcs.revision` / `vcs.head_commit` should come from a live git read
      // when possible; the original commit lives under `worktree`.
    }
  }

  if (Object.keys(meta).length > 0) hints.envelopeMeta = meta;
  return hints;
}

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
  let prevPermissionMode: string | undefined;
  // Tracks the most recent envelope timestamp seen in source order. Envelopes
  // missing `timestamp` (Claude Code emits `permission-mode` records with no
  // timestamp) inherit this value so their synthesized entries land in
  // session-order rather than failing validation.
  let inheritedTimestamp: string | undefined;

  for (const envelope of envelopes) {
    if (!isTracerEnvelope(envelope)) continue;
    if (typeof envelope.timestamp === "string") {
      inheritedTimestamp = envelope.timestamp;
    }
    if (envelope.type === "permission-mode") {
      const pmEntries = mapPermissionModeEnvelope(envelope, inheritedTimestamp, prevPermissionMode);
      for (const entry of pmEntries) {
        built.push({ entry, parentSourceId: envelope.parentUuid ?? null });
      }
      const mode = stringValue(envelope.permissionMode);
      if (mode !== undefined) prevPermissionMode = mode;
      continue;
    }
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
          parentSourceId: envelope.parentUuid,
        });
      }
    }
    entries.forEach((entry, index) => {
      built.push({
        entry,
        parentSourceId: envelope.parentUuid,
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
