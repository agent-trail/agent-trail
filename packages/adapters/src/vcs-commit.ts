import type { Entry } from "@agent-trail/types";
import { deriveSynthesizedEntryId } from "./session-uid.ts";

export type GitCommitEventData = {
  sha: string;
  tool_call_id: string;
  branch?: string;
  message?: string;
  repo?: string;
};

type ExtractGitCommitEventsInput = {
  command: string;
  output: string;
  toolCallId: string;
  repo?: string;
};

type SynthesizeVcsCommitEventsOptions = {
  idNamespace: string;
  repo?: string;
};

const GIT_COMMIT_COMMAND_PATTERN = /(?:^|[\s;&|()])git\s+commit(?:\s|$)/;
const GIT_COMMIT_SUMMARY_PATTERN = /^\[(.+)\s+([a-fA-F0-9]{7,64})\]\s+(.+)$/;

export function extractGitCommitEvents(input: ExtractGitCommitEventsInput): GitCommitEventData[] {
  if (!GIT_COMMIT_COMMAND_PATTERN.test(input.command)) return [];
  const commits: GitCommitEventData[] = [];
  for (const line of input.output.split(/\r?\n/)) {
    const match = GIT_COMMIT_SUMMARY_PATTERN.exec(line.trim());
    if (match === null) continue;
    const [, branch, sha, message] = match;
    if (branch === undefined || sha === undefined || message === undefined) continue;
    commits.push({
      sha: sha.toLowerCase(),
      tool_call_id: input.toolCallId,
      branch,
      message,
      ...(input.repo !== undefined ? { repo: input.repo } : {}),
    });
  }
  return commits;
}

function objectPayload(entry: Entry): Record<string, unknown> {
  return entry.payload !== null && typeof entry.payload === "object"
    ? (entry.payload as Record<string, unknown>)
    : {};
}

function commandFromToolCall(entry: Entry): string | undefined {
  if (entry.type !== "tool_call") return undefined;
  const payload = objectPayload(entry);
  if (payload.tool !== "shell_command") return undefined;
  const args = payload.args;
  if (args === null || typeof args !== "object") return undefined;
  const command = (args as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
}

function sourceForCommit(result: Entry): Entry["source"] {
  const source = result.source;
  const originalType =
    typeof source?.original_type === "string" ? `${source.original_type}.vcs_commit` : "vcs_commit";
  return {
    ...(source?.agent !== undefined ? { agent: source.agent } : {}),
    original_type: originalType,
    ...(source?.schema_version !== undefined ? { schema_version: source.schema_version } : {}),
    synthesized: true,
  };
}

export function synthesizeVcsCommitEvents(
  entries: Entry[],
  options: SynthesizeVcsCommitEventsOptions,
): Entry[] {
  const callsById = new Map<string, Entry>();
  const callsByNativeId = new Map<string, Entry>();
  for (const entry of entries) {
    if (commandFromToolCall(entry) === undefined) continue;
    callsById.set(entry.id, entry);
    const nativeCallId = entry.semantic?.call_id;
    if (nativeCallId !== undefined) callsByNativeId.set(nativeCallId, entry);
  }

  const out: Entry[] = [];
  for (const entry of entries) {
    out.push(entry);
    if (entry.type !== "tool_result") continue;
    const payload = objectPayload(entry);
    if (payload.ok !== true || typeof payload.output !== "string") continue;
    const forId = typeof payload.for_id === "string" ? payload.for_id : undefined;
    const nativeCallId = entry.semantic?.call_id;
    const call =
      (forId !== undefined ? callsById.get(forId) : undefined) ??
      (nativeCallId !== undefined ? callsByNativeId.get(nativeCallId) : undefined);
    if (call === undefined) continue;
    const command = commandFromToolCall(call);
    if (command === undefined) continue;
    const commits = extractGitCommitEvents({
      command,
      output: payload.output,
      toolCallId: call.id,
      repo: options.repo,
    });
    for (const [index, commit] of commits.entries()) {
      out.push({
        type: "system_event",
        id: deriveSynthesizedEntryId(options.idNamespace, [
          "vcs_commit",
          entry.id,
          commit.sha,
          String(index),
        ]),
        ts: entry.ts,
        payload: { kind: "vcs_commit", data: commit },
        ...(nativeCallId !== undefined ? { semantic: { call_id: nativeCallId } } : {}),
        source: sourceForCommit(entry),
      } as Entry);
    }
  }
  return out;
}
