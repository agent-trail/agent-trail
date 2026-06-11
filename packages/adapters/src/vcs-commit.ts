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

const GIT_COMMIT_SUMMARY_PATTERN =
  /^\[(?<ref>.+?)(?:\s+\(root-commit\))?\s+(?<sha>[a-fA-F0-9]{7,64})\]\s?(?<message>.*)$/;
const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=.*/;

function shellCommandSegments(command: string): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  const pushToken = (): void => {
    if (token.length === 0) return;
    current.push(token);
    token = "";
  };
  const endSegment = (): void => {
    pushToken();
    if (current.length === 0) return;
    segments.push(current);
    current = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    const next = command[index + 1];

    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        token += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    if (
      char === ";" ||
      char === "(" ||
      char === ")" ||
      char === "|" ||
      (char === "&" && next === "&")
    ) {
      endSegment();
      if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
        index += 1;
      }
      continue;
    }
    token += char;
  }
  endSegment();
  return segments;
}

function gitSubcommandIndex(tokens: string[], gitIndex: number): number | undefined {
  let index = gitIndex + 1;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (
      token === "-C" ||
      token === "-c" ||
      token === "--git-dir" ||
      token === "--work-tree" ||
      token === "--namespace"
    ) {
      index += 2;
      continue;
    }
    if (
      token === "--no-pager" ||
      token === "--bare" ||
      token.startsWith("-c") ||
      token.startsWith("--git-dir=") ||
      token.startsWith("--work-tree=") ||
      token.startsWith("--namespace=")
    ) {
      index += 1;
      continue;
    }
    return index;
  }
  return undefined;
}

function gitCommitInvocationCount(command: string): number {
  let count = 0;
  for (const segment of shellCommandSegments(command)) {
    let commandIndex = 0;
    while (ENV_ASSIGNMENT_PATTERN.test(segment[commandIndex] ?? "")) commandIndex += 1;
    if (segment[commandIndex] === "command") commandIndex += 1;
    const executable = segment[commandIndex];
    if (executable !== "git" && executable?.endsWith("/git") !== true) continue;
    const subcommandIndex = gitSubcommandIndex(segment, commandIndex);
    if (subcommandIndex !== undefined && segment[subcommandIndex] === "commit") count += 1;
  }
  return count;
}

export function extractGitCommitEvents(input: ExtractGitCommitEventsInput): GitCommitEventData[] {
  const invocationCount = gitCommitInvocationCount(input.command);
  if (invocationCount === 0) return [];
  const commits: GitCommitEventData[] = [];
  for (const line of input.output.split(/\r?\n/)) {
    if (commits.length >= invocationCount) break;
    const match = GIT_COMMIT_SUMMARY_PATTERN.exec(line.trimEnd());
    if (match === null) continue;
    const { ref, sha, message } = match.groups ?? {};
    if (ref === undefined || sha === undefined || message === undefined) continue;
    commits.push({
      sha: sha.toLowerCase(),
      tool_call_id: input.toolCallId,
      branch: ref,
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
        parent_id: entry.id,
        ...(nativeCallId !== undefined ? { semantic: { call_id: nativeCallId } } : {}),
        source: sourceForCommit(entry),
      } as Entry);
    }
  }
  return out;
}
