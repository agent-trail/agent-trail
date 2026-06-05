import type { TrailEntryDraft } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import { type CcEnvelope, isObject, stringValue } from "../source.ts";
import { gate, meta, metadataSource, type Raw } from "./shared.ts";

const aiTitleMetadata = defineMapping<Raw>({
  match: { type: "ai-title" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const aiTitle = stringValue(record.aiTitle);
    if (aiTitle === undefined) return [];
    return [
      {
        type: "session_metadata_update",
        payload: { field: "name", value: aiTitle, reason: "ai_generated" },
        source: metadataSource(record, "ai-title"),
        meta: meta(record),
      },
    ];
  },
});

const agentNameMetadata = defineMapping<Raw>({
  match: { type: "agent-name" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const agentName = stringValue(record.agentName);
    if (agentName === undefined) return [];
    return [
      {
        type: "session_metadata_update",
        payload: {
          field: "x-claudecode/agent_name",
          value: agentName,
          reason: "ai_generated",
        },
        source: metadataSource(record, "agent-name"),
        meta: meta(record),
      },
    ];
  },
});

const worktreeStateMetadata = defineMapping<Raw>({
  match: { type: "worktree-state" },
  emit: (raw) => {
    const record = raw as CcEnvelope;
    if (!gate(record, true)) return [];
    const ws = isObject(record.worktreeSession) ? record.worktreeSession : undefined;
    if (ws === undefined) return [];

    const entries: TrailEntryDraft[] = [];
    const branch = stringValue(ws.worktreeBranch);
    if (branch !== undefined) {
      entries.push({
        type: "session_metadata_update",
        payload: { field: "vcs.branch", value: branch, reason: "runtime_inferred" },
        source: metadataSource(record, "worktree-state"),
        meta: meta(record),
      });
    }

    const name = stringValue(ws.worktreeName);
    const path = stringValue(ws.worktreePath);
    if (name !== undefined && path !== undefined) {
      const worktree: Record<string, unknown> = { name, path };
      const originalCwd = stringValue(ws.originalCwd);
      const originalBranch = stringValue(ws.originalBranch);
      const originalHeadCommit = stringValue(ws.originalHeadCommit);
      if (originalCwd !== undefined) worktree.original_cwd = originalCwd;
      if (originalBranch !== undefined) worktree.original_branch = originalBranch;
      if (originalHeadCommit !== undefined && /^[a-f0-9]{7,64}$/.test(originalHeadCommit)) {
        worktree.original_head_commit = originalHeadCommit;
      }
      entries.push({
        type: "session_metadata_update",
        payload: { field: "vcs.worktree", value: worktree, reason: "runtime_inferred" },
        source: metadataSource(record, "worktree-state"),
        meta: meta(record),
      });
    }

    return entries;
  },
});

export const metadataMappings = [aiTitleMetadata, agentNameMetadata, worktreeStateMetadata];
