import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";
import type { SessionGroup } from "./session-groups.ts";

// Spec §9.6: sessions in a multi-session file SHOULD appear in chronological
// order by header `ts`. Out-of-order placement is a warning, not an error —
// readers tolerate it but writers SHOULD sort.
export function outOfOrderSessionHeadersWarnings(groups: SessionGroup[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let prevTs: string | undefined;
  for (const group of groups) {
    const ts = group.header.value.ts;
    if (typeof ts !== "string") continue;
    if (prevTs !== undefined && ts < prevTs) {
      diagnostics.push(
        createDiagnostic({
          line: group.header.line,
          path: "/ts",
          severity: "warning",
          code: "out_of_order_session_headers",
          message: `session header ts "${ts}" precedes earlier session header ts "${prevTs}"`,
        }),
      );
    }
    if (prevTs === undefined || ts > prevTs) {
      prevTs = ts;
    }
  }
  return diagnostics;
}

// Spec §9.6: sessions in the same trail file MAY carry different working-tree
// state, but divergent `vcs.revision` is unusual enough to flag once per
// later-occurring group.
export function vcsRevisionDivergenceWarnings(groups: SessionGroup[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let earliest: string | undefined;
  for (const group of groups) {
    const vcs = group.header.value.vcs;
    if (typeof vcs !== "object" || vcs === null) continue;
    const revision = (vcs as { revision?: unknown }).revision;
    if (typeof revision !== "string") continue;
    if (earliest === undefined) {
      earliest = revision;
      continue;
    }
    if (revision !== earliest) {
      diagnostics.push(
        createDiagnostic({
          line: group.header.line,
          path: "/vcs/revision",
          severity: "warning",
          code: "vcs_revision_divergence",
          message: `vcs.revision "${revision}" diverges from earlier session vcs.revision "${earliest}" in the same trail file`,
        }),
      );
    }
  }
  return diagnostics;
}

// Spec §9.6: `fork_from.session_id` MAY reference a sibling session in the
// same trail file. When it does and `fork_from.content_hash` is also present,
// the hash MUST match the sibling's session-level `content_hash`. Mismatch is
// a warning so renderers can still display the file. External references
// (session_id not matched in-file) are out of scope here.
export function crossGroupForkFromWarnings(groups: SessionGroup[]): Diagnostic[] {
  const siblingHashes = new Map<string, string>();
  for (const group of groups) {
    const id = group.header.value.id;
    const ch = group.header.value.content_hash;
    if (typeof id === "string" && typeof ch === "string" && ch !== "<pending>") {
      siblingHashes.set(id, ch);
    }
  }

  const diagnostics: Diagnostic[] = [];
  for (const group of groups) {
    const forkFrom = group.header.value.fork_from;
    if (typeof forkFrom !== "object" || forkFrom === null) continue;
    const sessionId = (forkFrom as { session_id?: unknown }).session_id;
    const claimedHash = (forkFrom as { content_hash?: unknown }).content_hash;
    if (typeof sessionId !== "string" || typeof claimedHash !== "string") continue;
    const siblingHash = siblingHashes.get(sessionId);
    if (siblingHash === undefined) continue;
    if (claimedHash !== siblingHash) {
      diagnostics.push(
        createDiagnostic({
          line: group.header.line,
          path: "/fork_from/content_hash",
          severity: "warning",
          code: "cross_group_fork_from_hash_mismatch",
          message: `fork_from.content_hash "${claimedHash}" does not match in-file sibling session content_hash "${siblingHash}"`,
        }),
      );
    }
  }
  return diagnostics;
}

type SubagentInvokeRef = {
  parentSessionId: string;
  callId: string;
  childSessionId?: string;
  line: number;
};

function subagentInvokeRef(group: SessionGroup, entry: JsonlRecord): SubagentInvokeRef | undefined {
  if (entry.value.type !== "tool_call") return undefined;
  const payload = entry.value.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const payloadRecord = payload as Record<string, unknown>;
  if (payloadRecord.tool !== "subagent_invoke") return undefined;
  const args = payloadRecord.args;
  if (typeof args !== "object" || args === null) return undefined;
  const argsRecord = args as Record<string, unknown>;
  const callId = entry.value.id;
  const parentSessionId = group.header.value.id;
  if (typeof callId !== "string" || typeof parentSessionId !== "string") return undefined;
  const childSessionId = argsRecord.session_id;
  return {
    parentSessionId,
    callId,
    childSessionId: typeof childSessionId === "string" ? childSessionId : undefined,
    line: entry.line,
  };
}

function forkFromOf(group: SessionGroup): { session_id?: string; entry_id?: string } | undefined {
  const forkFrom = group.header.value.fork_from;
  if (typeof forkFrom !== "object" || forkFrom === null) return undefined;
  const forkFromRecord = forkFrom as Record<string, unknown>;
  const sessionId = forkFromRecord.session_id;
  const entryId = forkFromRecord.entry_id;
  return {
    session_id: typeof sessionId === "string" ? sessionId : undefined,
    entry_id: typeof entryId === "string" ? entryId : undefined,
  };
}

// In-file child-session linking is advisory, not validity-critical. The child
// header's fork_from is authoritative, while parent subagent_invoke.session_id
// is a renderer-friendly back-reference when adapters can link confidently.
export function childSessionLinkWarnings(groups: SessionGroup[]): Diagnostic[] {
  const groupById = new Map<string, SessionGroup>();
  const subagentByCallId = new Map<string, SubagentInvokeRef>();
  const subagentsByChildId = new Map<string, SubagentInvokeRef[]>();

  for (const group of groups) {
    const groupId = group.header.value.id;
    if (typeof groupId === "string") groupById.set(groupId, group);
    for (const entry of group.entries) {
      const ref = subagentInvokeRef(group, entry);
      if (ref === undefined) continue;
      subagentByCallId.set(ref.callId, ref);
      if (ref.childSessionId !== undefined) {
        const existing = subagentsByChildId.get(ref.childSessionId) ?? [];
        existing.push(ref);
        subagentsByChildId.set(ref.childSessionId, existing);
      }
    }
  }

  const diagnostics: Diagnostic[] = [];

  for (const [childSessionId, refs] of subagentsByChildId) {
    const childGroup = groupById.get(childSessionId);
    if (childGroup === undefined) continue;
    for (const ref of refs) {
      const forkFrom = forkFromOf(childGroup);
      if (forkFrom?.session_id === ref.parentSessionId && forkFrom.entry_id === ref.callId) {
        continue;
      }
      diagnostics.push(
        createDiagnostic({
          line: childGroup.header.line,
          path: "/fork_from",
          severity: "warning",
          code: "child_session_fork_from_mismatch",
          message: `child session "${childSessionId}" is named by subagent_invoke "${ref.callId}" but does not fork_from that parent call`,
        }),
      );
    }
  }

  for (const childGroup of groups) {
    const childSessionId = childGroup.header.value.id;
    if (typeof childSessionId !== "string") continue;
    const forkFrom = forkFromOf(childGroup);
    if (forkFrom?.entry_id === undefined || forkFrom.session_id === undefined) continue;
    if (!groupById.has(forkFrom.session_id)) continue;
    const parentRef = subagentByCallId.get(forkFrom.entry_id);
    if (parentRef === undefined) continue;
    if (parentRef.parentSessionId !== forkFrom.session_id) continue;
    if (parentRef.childSessionId === childSessionId) continue;
    diagnostics.push(
      createDiagnostic({
        line: parentRef.line,
        path: "/payload/args/session_id",
        severity: "warning",
        code: "child_session_parent_link_mismatch",
        message:
          parentRef.childSessionId === undefined
            ? `subagent_invoke "${parentRef.callId}" does not name child session "${childSessionId}" that forks from it`
            : `subagent_invoke "${parentRef.callId}" points to child session "${parentRef.childSessionId}" but child header "${childSessionId}" forks from it`,
      }),
    );
  }

  return diagnostics;
}
