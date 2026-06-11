import { basename } from "node:path";
import { mapAgentMessageUsage } from "@agent-trail/adapter-kit";
import type { Header } from "@agent-trail/types";
import { arrayValue, numberValue, objectValue, type Raw, stringValue } from "./source.ts";

export function tokenTotalsFromSession(session: Raw): Raw | undefined {
  const usage = mapAgentMessageUsage({
    input: numberValue(session.tokens_input),
    output: numberValue(session.tokens_output),
    total: numberValue(session.tokens_total),
    reasoning_tokens: numberValue(session.tokens_reasoning),
    cache_read_tokens: numberValue(session.tokens_cache_read),
    cache_creation_tokens: numberValue(session.tokens_cache_write),
  });
  if (usage === undefined) return undefined;
  return {
    ...(usage.input_tokens !== undefined ? { input_tokens: usage.input_tokens } : {}),
    ...(usage.output_tokens !== undefined ? { output_tokens: usage.output_tokens } : {}),
    ...(usage.total_tokens !== undefined ? { total_tokens: usage.total_tokens } : {}),
    ...(usage.reasoning_tokens !== undefined ? { reasoning_tokens: usage.reasoning_tokens } : {}),
    ...(usage.cache_read_tokens !== undefined
      ? { cache_read_tokens: usage.cache_read_tokens }
      : {}),
    ...(usage.cache_creation_tokens !== undefined
      ? { cache_creation_tokens: usage.cache_creation_tokens }
      : {}),
  };
}

export function compactDiffs(value: unknown): Raw[] | undefined {
  const diffs = arrayValue(value);
  if (diffs === undefined) return undefined;
  return diffs.flatMap((diff) => {
    const obj = objectValue(diff);
    if (obj === undefined) return [];
    return [
      {
        ...(stringValue(obj.file) !== undefined ? { file: stringValue(obj.file) } : {}),
        ...(numberValue(obj.additions) !== undefined
          ? { additions: numberValue(obj.additions) }
          : {}),
        ...(numberValue(obj.deletions) !== undefined
          ? { deletions: numberValue(obj.deletions) }
          : {}),
        ...(stringValue(obj.status) !== undefined ? { status: stringValue(obj.status) } : {}),
      },
    ];
  });
}

export function todoItemsFrom(
  value: unknown,
): { id: string; content: string; status: ReturnType<typeof todoStatus> }[] {
  const todos = arrayValue(value);
  if (todos === undefined) return [];
  return Array.from(todos.entries()).flatMap(([index, todo]) => {
    const obj = objectValue(todo);
    if (obj === undefined) return [];
    const content = stringValue(obj.content);
    if (content === undefined) return [];
    const id = stringValue(obj.id)?.trim();
    return [
      {
        id: id !== undefined && id.length > 0 ? id : String(numberValue(obj.position) ?? index + 1),
        content,
        status: todoStatus(obj.status),
      },
    ];
  });
}

export function todoStatus(
  status: unknown,
): "pending" | "in_progress" | "completed" | "cancelled" | "blocked" {
  if (
    status === "in_progress" ||
    status === "completed" ||
    status === "cancelled" ||
    status === "blocked"
  )
    return status;
  return "pending";
}

export function worktreeFromProject(
  project: Raw | undefined,
): NonNullable<NonNullable<Header["vcs"]>["worktree"]> | undefined {
  const worktreePath = stringValue(project?.worktree);
  if (worktreePath === undefined) return undefined;
  return {
    name: stringValue(project?.name) ?? basename(worktreePath),
    path: worktreePath,
  };
}
