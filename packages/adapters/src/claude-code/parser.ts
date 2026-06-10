import type { Header } from "@agent-trail/types";
import {
  CLAUDE_CODE_SESSION_UID_NAMESPACE,
  canonicalizeIdentityString,
  deriveSessionUid,
} from "../session-uid.ts";
import { type CcEnvelope, isObject, isTracerEnvelope, stringValue } from "./source.ts";

const GIT_COMMIT_PATTERN = /^[a-f0-9]{7,64}$/;
const VCS_PROVENANCE_META_KEY = "dev.agent-trail.vcs_provenance";

// Session-level provenance constants carried on every record. Captured into
// header.meta under the adapter's reverse-DNS namespace for corpus filtering.
// See issue #126.
function provenanceMeta(
  envelopes: CcEnvelope[],
  options: { includeSidechain?: boolean },
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const entrypoint = firstString(envelopes, options, "entrypoint");
  if (entrypoint !== undefined) meta["dev.claudecode.entrypoint"] = entrypoint;
  const userType = firstString(envelopes, options, "userType");
  if (userType !== undefined) meta["dev.claudecode.user_type"] = userType;
  return meta;
}

function firstString(
  envelopes: CcEnvelope[],
  options: { includeSidechain?: boolean },
  key: string,
): string | undefined {
  for (const env of envelopes) {
    if (!isTracerEnvelope(env, options)) continue;
    const value = stringValue(env[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstWorktreeSession(
  envelopes: CcEnvelope[],
  options: { includeSidechain?: boolean },
  sessionId: string,
): Record<string, unknown> | undefined {
  for (const env of envelopes) {
    if (env.type !== "worktree-state") continue;
    if (env.isSidechain === true && options.includeSidechain !== true) continue;
    if (env.isMeta === true) continue;
    if (env.sessionId !== undefined && env.sessionId !== sessionId) continue;
    const worktreeSession = env.worktreeSession;
    if (isObject(worktreeSession)) return worktreeSession;
  }
  return undefined;
}

function sessionTimeVcs(
  envelopes: CcEnvelope[],
  options: { includeSidechain?: boolean },
  sessionId: string,
): { vcs: NonNullable<Header["vcs"]>; provenance: Record<string, string> } | undefined {
  const worktreeSession = firstWorktreeSession(envelopes, options, sessionId);
  const originalHeadCommit = stringValue(worktreeSession?.originalHeadCommit);
  if (originalHeadCommit === undefined || !GIT_COMMIT_PATTERN.test(originalHeadCommit)) {
    return undefined;
  }

  const vcs: NonNullable<Header["vcs"]> = {
    type: "git",
    revision: originalHeadCommit,
    head_commit: originalHeadCommit,
  };
  const provenance: Record<string, string> = {
    revision: "claude-code.worktree-state.originalHeadCommit",
    head_commit: "claude-code.worktree-state.originalHeadCommit",
  };

  const branch = firstString(envelopes, options, "gitBranch");
  if (branch !== undefined) {
    vcs.branch = branch;
    provenance.branch = "claude-code.gitBranch";
  }

  const name = stringValue(worktreeSession?.worktreeName);
  const path = stringValue(worktreeSession?.worktreePath);
  if (name !== undefined && path !== undefined) {
    const worktree: NonNullable<NonNullable<Header["vcs"]>["worktree"]> = { name, path };
    const originalCwd = stringValue(worktreeSession?.originalCwd);
    const originalBranch = stringValue(worktreeSession?.originalBranch);
    if (originalCwd !== undefined) worktree.original_cwd = originalCwd;
    if (originalBranch !== undefined) worktree.original_branch = originalBranch;
    worktree.original_head_commit = originalHeadCommit;
    vcs.worktree = worktree;
    provenance.worktree = "claude-code.worktree-state";
  }

  return { vcs, provenance };
}

export function buildHeader(
  envelopes: CcEnvelope[],
  options: { includeSidechain?: boolean } = {},
): Header {
  const first = envelopes.find(
    (env) => isTracerEnvelope(env, options) && env.timestamp !== undefined,
  );
  const firstSession = envelopes.find(
    (env) => isTracerEnvelope(env, options) && env.sessionId !== undefined,
  );
  const firstTs = first?.timestamp;
  if (first === undefined || firstTs === undefined || firstSession?.sessionId === undefined) {
    throw new Error("Claude Code session has no parseable records");
  }
  const firstVersion = first.version ?? firstSession.version;
  const sessionId = canonicalizeIdentityString(firstSession.sessionId);
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id: sessionId,
    session_uid: deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, sessionId),
    ts: firstTs,
    agent: {
      name: "claude-code",
      ...(firstVersion !== undefined ? { version: firstVersion } : {}),
    },
  };
  if (first.cwd !== undefined) header.cwd = first.cwd;
  const meta = provenanceMeta(envelopes, options);
  if (Object.keys(meta).length > 0) header.meta = meta;
  const transcriptVcs = sessionTimeVcs(envelopes, options, firstSession.sessionId);
  if (transcriptVcs !== undefined) {
    header.vcs = transcriptVcs.vcs;
    header.meta = {
      ...(header.meta ?? {}),
      [VCS_PROVENANCE_META_KEY]: transcriptVcs.provenance,
    };
  }
  header.source = {
    agent: "claude-code",
    ...(firstVersion !== undefined ? { format_version: firstVersion } : {}),
  };
  return header;
}
