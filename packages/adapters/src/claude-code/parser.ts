import type { Header } from "@agent-trail/types";
import { CLAUDE_CODE_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import type { WorktreeInfo } from "../vcs.ts";
import { type CcEnvelope, isTracerEnvelope, stringValue } from "./source.ts";

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

export function buildHeader(envelopes: CcEnvelope[]): Header {
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
