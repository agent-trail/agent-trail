import { coerceInt as maybeNumber, quoteShellArg } from "@agent-trail/adapter-kit";
import { isObject, jsonObjectValue, stringValue } from "./source.ts";

// `oldText` / `newText` may span multiple lines. A unified diff requires every
// removed line to be prefixed with `-` and every added line with `+`, so we
// split on `\n` and prefix each line individually. Empty `oldText` (pure insert)
// and empty `newText` (pure delete) emit no `-`/`+` lines respectively.
function prefixLines(text: string, prefix: string): string[] {
  if (text.length === 0) return [];
  return text.split("\n").map((line) => `${prefix}${line}`);
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

// Pi `edit` shapes (single-replace, edits[], single-path multi) carry no line
// numbers, only oldText/newText pairs. To stay spec §10.1 conformant we emit
// `@@ -1,<oldN> +1,<newN> @@` with synthetic start lines (1) and accurate
// line counts derived from the texts themselves. Downstream readers that
// only care about hunk bodies render correctly; strict unified-diff parsers
// accept the header format. `source.raw` preserves the original Pi args.
function buildDiff(path: string, hunks: Array<{ oldText: string; newText: string }>): string {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks.flatMap((h) => [
      `@@ -1,${lineCount(h.oldText)} +1,${lineCount(h.newText)} @@`,
      ...prefixLines(h.oldText, "-"),
      ...prefixLines(h.newText, "+"),
    ]),
  ].join("\n");
}

// Pi's built-in tools (pi-mono `coding-agent/src/core/tools/`): bash, read, write, edit,
// grep, find, ls. Mapped to canonical kinds (spec §10). MCP-extension tools real Pi
// sessions also carry fall through to the `other` escape hatch (spec §10.5).
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
      if (path !== undefined) return { tool: "file_read", args: { path } };
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
      // Single-replace, single-path multi, and edits-array map cleanly to spec §10.1
      // `file_edit` (single-file unified diff). The patch shape and cross-file multi
      // shapes fall through to `other` so `source.raw` preserves them verbatim.
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
          return {
            tool: "file_edit",
            args: { path: topPath, diff: buildDiff(topPath, hunks) },
          };
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
        if (!bad && editsByPath.size === 1) {
          const [path, hunks] = [...editsByPath.entries()][0] as [
            string,
            Array<{ oldText: string; newText: string }>,
          ];
          if (hunks.length > 0) {
            return { tool: "file_edit", args: { path, diff: buildDiff(path, hunks) } };
          }
        }
        break;
      }
      if (topPath !== undefined) {
        const oldText = stringValue(args.oldText) ?? stringValue(args.oldString);
        const newText = stringValue(args.newText) ?? stringValue(args.newString);
        if (oldText !== undefined || newText !== undefined) {
          return {
            tool: "file_edit",
            args: {
              path: topPath,
              diff: buildDiff(topPath, [{ oldText: oldText ?? "", newText: newText ?? "" }]),
            },
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
      // Pi `ls` lists a directory; spec §10 has no `list_directory` kind. Synthesize
      // a `shell_command` of the form `ls -- <path>` (POSIX option terminator) so
      // paths beginning with `-` are not parsed as flags by replay tools. Original
      // Pi args remain available in `source.raw` for high-fidelity readers.
      const path = stringValue(args.path);
      return {
        tool: "shell_command",
        args: { command: path !== undefined ? `ls -- ${quoteShellArg(path)}` : "ls" },
      };
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
