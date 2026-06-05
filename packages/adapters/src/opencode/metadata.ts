import { basename } from "node:path";
import type { Header } from "@agent-trail/types";
import { arrayValue, numberValue, objectValue, type Raw, stringValue } from "./source.ts";

export function tokenTotalsFromSession(session: Raw): Raw | undefined {
  const input = numberValue(session.tokens_input);
  const output = numberValue(session.tokens_output);
  const reasoning = numberValue(session.tokens_reasoning);
  const cacheRead = numberValue(session.tokens_cache_read);
  const cacheWrite = numberValue(session.tokens_cache_write);
  if (
    input === undefined &&
    output === undefined &&
    reasoning === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined
  ) {
    return undefined;
  }
  return {
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    ...(reasoning !== undefined ? { reasoning_tokens: reasoning } : {}),
    ...(cacheRead !== undefined ? { cache_read_tokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cache_creation_tokens: cacheWrite } : {}),
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
  return todos.flatMap((todo, index) => {
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
