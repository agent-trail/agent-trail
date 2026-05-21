import { isObject, jsonObjectValue, stringValue } from "./source.ts";

function maybeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Pi's four built-in tools (per pi-mono). Anything else — including MCP-extension
// tools real sessions carry — falls through to the `other` escape hatch (spec §10.5).
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
      const path = stringValue(args.path) ?? stringValue(args.file_path);
      const oldString = stringValue(args.oldString) ?? stringValue(args.old_string);
      const newString = stringValue(args.newString) ?? stringValue(args.new_string);
      if (path !== undefined && (oldString !== undefined || newString !== undefined)) {
        const diff = [
          `--- a/${path}`,
          `+++ b/${path}`,
          "@@",
          `-${oldString ?? ""}`,
          `+${newString ?? ""}`,
        ].join("\n");
        return { tool: "file_edit", args: { path, diff } };
      }
      break;
    }
    case "bash": {
      const command = stringValue(args.command) ?? stringValue(args.cmd);
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
  }
  return {
    tool: "other",
    args: {
      ...(name !== undefined ? { name } : { name: "unknown" }),
      ...(isObject(input) ? { args: input } : {}),
    },
  };
}
