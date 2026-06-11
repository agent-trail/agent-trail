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

type ShellCommandShape = {
  hasUnsafeSeparator: boolean;
  segments: string[][];
};

function shellCommandShape(command: string): ShellCommandShape {
  const segments: string[][] = [];
  let hasUnsafeSeparator = false;
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
    if (char === "\n" || char === "\r") {
      endSegment();
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      continue;
    }
    if (/\s/.test(char)) {
      pushToken();
      continue;
    }
    if (char === ";" || char === "(" || char === ")" || char === "|" || char === "&") {
      const isAndAnd = char === "&" && next === "&";
      const isOrOr = char === "|" && next === "|";
      if (char === "|" || char === "(" || char === ")" || (char === "&" && !isAndAnd)) {
        hasUnsafeSeparator = true;
      }
      endSegment();
      if (isAndAnd || isOrOr) {
        index += 1;
      }
      continue;
    }
    token += char;
  }
  endSegment();
  return { hasUnsafeSeparator, segments };
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

type GitCommandInfo = {
  subcommand: string;
  args: string[];
};

function gitCommandInfo(segment: string[]): GitCommandInfo | undefined {
  let commandIndex = 0;
  while (ENV_ASSIGNMENT_PATTERN.test(segment[commandIndex] ?? "")) commandIndex += 1;
  if (segment[commandIndex] === "command") commandIndex += 1;
  const executable = segment[commandIndex];
  if (executable !== "git" && executable?.endsWith("/git") !== true) return undefined;
  const subcommandIndex = gitSubcommandIndex(segment, commandIndex);
  if (subcommandIndex === undefined) return undefined;
  return {
    subcommand: segment[subcommandIndex]!,
    args: segment.slice(subcommandIndex + 1),
  };
}

function isSafeWrapperSegment(segment: string[]): boolean {
  let commandIndex = 0;
  while (ENV_ASSIGNMENT_PATTERN.test(segment[commandIndex] ?? "")) commandIndex += 1;
  return segment[commandIndex] === "cd";
}

function hasQuietFlag(args: string[]): boolean {
  return args.some((arg) => {
    if (arg === "--quiet" || arg === "-q") return true;
    return arg.startsWith("-") && !arg.startsWith("--") && arg.slice(1).includes("q");
  });
}

function eligibleGitCommitInvocationCount(command: string): number {
  const shape = shellCommandShape(command);
  if (shape.hasUnsafeSeparator) return 0;
  let count = 0;
  for (const segment of shape.segments) {
    const git = gitCommandInfo(segment);
    if (git === undefined && isSafeWrapperSegment(segment)) continue;
    if (git?.subcommand !== "add" && git?.subcommand !== "commit") return 0;
    if (git.subcommand === "commit") {
      if (hasQuietFlag(git.args)) return 0;
      count += 1;
    }
  }
  return count;
}

export function extractGitCommitEvents(input: ExtractGitCommitEventsInput): GitCommitEventData[] {
  const invocationCount = eligibleGitCommitInvocationCount(input.command);
  if (invocationCount === 0) return [];
  const commits: GitCommitEventData[] = [];
  for (const line of input.output.split(/\r?\n/)) {
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
  return commits.length === invocationCount ? commits : [];
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
  type SeenCall = Entry | "ambiguous";
  const callsById = new Map<string, Entry>();
  const callsByNativeId = new Map<string, SeenCall>();

  const out: Entry[] = [];
  let reparentNextChild:
    | {
        parentId: string;
        replacementParentId: string;
      }
    | undefined;
  for (const entry of entries) {
    let current = entry;
    if (reparentNextChild !== undefined) {
      if (current.parent_id === reparentNextChild.parentId) {
        current = { ...current, parent_id: reparentNextChild.replacementParentId } as Entry;
      }
      reparentNextChild = undefined;
    }

    out.push(current);
    const currentCommand = commandFromToolCall(current);
    if (currentCommand !== undefined) {
      callsById.set(current.id, current);
      const nativeCallId = current.semantic?.call_id;
      if (nativeCallId !== undefined) {
        callsByNativeId.set(
          nativeCallId,
          callsByNativeId.has(nativeCallId) ? "ambiguous" : current,
        );
      }
      continue;
    }
    if (current.type !== "tool_result") continue;
    const payload = objectPayload(current);
    if (payload.ok !== true || typeof payload.output !== "string") continue;
    const forId = typeof payload.for_id === "string" ? payload.for_id : undefined;
    const nativeCallId = current.semantic?.call_id;
    const nativeCallMatch =
      nativeCallId !== undefined ? callsByNativeId.get(nativeCallId) : undefined;
    const callByNativeId = nativeCallMatch !== "ambiguous" ? nativeCallMatch : undefined;
    const call = (forId !== undefined ? callsById.get(forId) : undefined) ?? callByNativeId;
    if (call === undefined) continue;
    const command = commandFromToolCall(call);
    if (command === undefined) continue;
    const commits = extractGitCommitEvents({
      command,
      output: payload.output,
      toolCallId: call.id,
      repo: options.repo,
    });
    let parentId = current.id;
    for (const [index, commit] of commits.entries()) {
      const commitEntry = {
        type: "system_event",
        id: deriveSynthesizedEntryId(options.idNamespace, [
          "vcs_commit",
          current.id,
          commit.sha,
          String(index),
        ]),
        ts: current.ts,
        payload: { kind: "vcs_commit", data: commit },
        parent_id: parentId,
        ...(nativeCallId !== undefined ? { semantic: { call_id: nativeCallId } } : {}),
        source: sourceForCommit(current),
      } as Entry;
      out.push(commitEntry);
      parentId = commitEntry.id;
    }
    if (commits.length > 0) {
      reparentNextChild = { parentId: current.id, replacementParentId: parentId };
    }
  }
  return out;
}
