import { coerceInt as maybeNumber, quoteShellArg } from "@agent-trail/adapter-kit";
import { isObject, jsonObjectValue, stringValue } from "./source.ts";

const PATCH_FILE_MARKER = /^\*\*\* (Update|Add|Delete) File: (.+)$/gm;

function endPatchIndex(input: string, start: number): number {
  const tail = input.slice(start);
  const match = tail.match(/^\*\*\* End Patch\b/m);
  return match?.index === undefined ? -1 : start + match.index;
}

function countPrefixedLines(lines: string[], prefix: string): number {
  return lines.filter((line) => line.startsWith(prefix)).length;
}

function normalizePatchBody(action: "Update" | "Add" | "Delete", body: string): string {
  const diffBody = body
    .split("\n")
    .filter((line) => !line.startsWith("*** Move to:") && line !== "*** End of File")
    .join("\n")
    .trim();
  if (diffBody.length === 0 || /^@@/m.test(diffBody)) return diffBody;

  const lines = diffBody.split("\n");
  const oldCount = action === "Add" ? 0 : countPrefixedLines(lines, "-");
  const newCount = action === "Delete" ? 0 : countPrefixedLines(lines, "+");
  return [`@@ -1,${oldCount} +1,${newCount} @@`, diffBody].join("\n");
}

function patchFiles(input: string): Array<{ path: string; diff: string }> {
  const matches = [...input.matchAll(PATCH_FILE_MARKER)];
  const files: Array<{ path: string; diff: string }> = [];
  for (const [index, match] of matches.entries()) {
    const action = match[1];
    const sourcePath = match[2];
    if (
      (action !== "Update" && action !== "Add" && action !== "Delete") ||
      sourcePath === undefined
    ) {
      continue;
    }
    const path = sourcePath.trim();
    if (path.length === 0) continue;
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? endPatchIndex(input, start);
    const body = input.slice(start, end === -1 ? undefined : end).trim();
    const moveTo = body.match(/^\*\*\* Move to: (.+)$/m)?.[1]?.trim();
    const newPath = moveTo && moveTo.length > 0 ? moveTo : path;
    const oldHeader = action === "Add" ? "/dev/null" : `a/${path}`;
    const newHeader = action === "Delete" ? "/dev/null" : `b/${newPath}`;
    const diffBody = normalizePatchBody(action, body);
    files.push({
      path: newPath,
      diff: [`--- ${oldHeader}`, `+++ ${newHeader}`, diffBody]
        .filter((part) => part.length > 0)
        .join("\n"),
    });
  }
  return files;
}

// Pi's built-in tools (pi-mono `coding-agent/src/core/tools/`): bash, read, write, edit,
// grep, find, ls. Mapped to canonical kinds (spec §11). MCP-extension tools real Pi
// sessions also carry fall through to the `other` escape hatch (spec §11.7).
export function toolKindAndArgs(
  name: string | undefined,
  input: unknown,
): {
  tool: string;
  args: object;
} {
  const args = jsonObjectValue(input) ?? {};
  switch (name) {
    case "read": {
      const path = stringValue(args.path) ?? stringValue(args.file_path);
      const offset = maybeNumber(args.offset);
      const limit = maybeNumber(args.limit);
      if (path !== undefined) {
        return {
          tool: "file_read",
          args: {
            path,
            ...(offset !== undefined && limit !== undefined
              ? { range: [offset, offset + limit] }
              : {}),
          },
        };
      }
      break;
    }
    case "write": {
      const path = stringValue(args.path) ?? stringValue(args.file_path);
      const content = stringValue(args.content);
      if (path !== undefined && content !== undefined) {
        return { tool: "file_write", args: { path, content } };
      }
      break;
    }
    case "edit": {
      // Pi `edit` arguments empirically come in four shapes:
      //   single-replace:  { path, oldText, newText }
      //   multi-replace:   { multi: [{ path, oldText, newText }, ...] }   (path is per-entry)
      //   edits-array:     { path, edits: [{ oldText, newText }, ...] }   (current pi-mono schema)
      //   apply_patch:     { patch: "*** Begin Patch\n*** Update File: ...\n..." }
      // One-hunk replacement shapes map to spec §11.1 `file_edit` replacement
      // args. Multi-hunk/no-line-context shapes fall through to `other` so we
      // do not fabricate diff hunk headers. Real patch text still maps to
      // `file_edit`/`file_patch`.
      const topPath = stringValue(args.path) ?? stringValue(args.file_path);
      const editsArray = Array.isArray(args.edits) ? args.edits : undefined;
      if (editsArray !== undefined && topPath !== undefined) {
        const hunks: Array<{ oldText: string; newText: string }> = [];
        for (const e of editsArray) {
          if (!isObject(e)) continue;
          const oldText = stringValue(e.oldText) ?? stringValue(e.old_text);
          const newText = stringValue(e.newText) ?? stringValue(e.new_text);
          if (oldText !== undefined || newText !== undefined) {
            hunks.push({ oldText: oldText ?? "", newText: newText ?? "" });
          }
        }
        if (hunks.length > 0) {
          if (hunks.length === 1) {
            const hunk = hunks[0]!;
            return {
              tool: "file_edit",
              args: { path: topPath, old: hunk.oldText, new: hunk.newText },
            };
          }
          break;
        }
        break;
      }
      const multi = Array.isArray(args.multi) ? args.multi : undefined;
      if (multi !== undefined && multi.length > 0) {
        const editsByPath = new Map<string, Array<{ oldText: string; newText: string }>>();
        let bad = false;
        for (const e of multi) {
          if (!isObject(e)) {
            bad = true;
            break;
          }
          const p = stringValue(e.path) ?? topPath;
          if (p === undefined) {
            bad = true;
            break;
          }
          const oldText = stringValue(e.oldText) ?? stringValue(e.old_text);
          const newText = stringValue(e.newText) ?? stringValue(e.new_text);
          if (oldText === undefined && newText === undefined) continue;
          const arr = editsByPath.get(p) ?? [];
          arr.push({ oldText: oldText ?? "", newText: newText ?? "" });
          editsByPath.set(p, arr);
        }
        if (!bad && editsByPath.size > 1) break;
        if (!bad && editsByPath.size === 1) {
          const [path, hunks] = [...editsByPath.entries()][0] as [
            string,
            Array<{ oldText: string; newText: string }>,
          ];
          if (hunks.length > 0) {
            if (hunks.length === 1) {
              const hunk = hunks[0]!;
              return { tool: "file_edit", args: { path, old: hunk.oldText, new: hunk.newText } };
            }
            break;
          }
        }
        break;
      }
      const patch = stringValue(args.patch);
      if (patch !== undefined) {
        const files = patchFiles(patch);
        if (files.length > 1) return { tool: "file_patch", args: { files, atomic: true } };
        if (files.length === 1) {
          const file = files[0];
          if (file !== undefined) return { tool: "file_edit", args: file };
        }
        break;
      }
      if (topPath !== undefined) {
        const oldText = stringValue(args.oldText) ?? stringValue(args.oldString);
        const newText = stringValue(args.newText) ?? stringValue(args.newString);
        if (oldText !== undefined || newText !== undefined) {
          return {
            tool: "file_edit",
            args: { path: topPath, old: oldText ?? "", new: newText ?? "" },
          };
        }
      }
      break;
    }
    case "bash": {
      // Defensive arg shapes (real Pi sessions): `{command: "..."}`, `{cmd: "..."}`, and
      // `{command: ["bash", "-lc", "..."]}` (argv-style). Quote argv entries with shell-special
      // chars so the canonical `args.command` string round-trips through a POSIX shell.
      const commandArray = Array.isArray(args.command)
        ? args.command.filter((p): p is string => typeof p === "string")
        : undefined;
      const command =
        stringValue(args.command) ??
        stringValue(args.cmd) ??
        (commandArray !== undefined && commandArray.length > 0
          ? commandArray.map(quoteShellArg).join(" ")
          : undefined);
      if (command !== undefined) {
        return {
          tool: "shell_command",
          args: {
            command,
            ...(stringValue(args.cwd) !== undefined ? { cwd: stringValue(args.cwd) } : {}),
            ...(maybeNumber(args.timeout) !== undefined
              ? { timeout: maybeNumber(args.timeout) }
              : {}),
          },
        };
      }
      break;
    }
    case "grep": {
      const pattern = stringValue(args.pattern);
      if (pattern !== undefined) {
        return {
          tool: "file_search",
          args: {
            query: pattern,
            ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
            ...(stringValue(args.glob) !== undefined ? { glob: stringValue(args.glob) } : {}),
          },
        };
      }
      break;
    }
    case "find": {
      const pattern = stringValue(args.pattern);
      if (pattern !== undefined) {
        return {
          tool: "file_search",
          args: {
            query: pattern,
            ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
          },
        };
      }
      break;
    }
    case "ls": {
      const path = stringValue(args.path);
      return { tool: "file_list", args: { path: path ?? "." } };
    }
  }
  return {
    tool: "other",
    args: {
      ...(name !== undefined ? { name } : { name: "unknown" }),
      ...(isObject(input) ? { args: input } : {}),
    },
  };
}
