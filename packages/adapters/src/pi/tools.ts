import { isObject, jsonObjectValue, stringValue } from "./source.ts";

function maybeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

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
    case "grep": {
      const query = stringValue(args.pattern) ?? stringValue(args.query);
      if (query !== undefined) {
        return {
          tool: "file_search",
          args: {
            query,
            ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
            ...(stringValue(args.glob) !== undefined ? { glob: stringValue(args.glob) } : {}),
          },
        };
      }
      break;
    }
    case "glob":
    case "find": {
      const query = stringValue(args.pattern) ?? stringValue(args.query) ?? stringValue(args.path);
      const glob = stringValue(args.pattern) ?? stringValue(args.glob);
      if (query !== undefined) {
        return {
          tool: "file_search",
          args: {
            query,
            ...(glob !== undefined ? { glob } : {}),
          },
        };
      }
      break;
    }
    case "web":
    case "webFetch": {
      const url = stringValue(args.url);
      if (url !== undefined) return { tool: "web_fetch", args: { url } };
      break;
    }
    case "webSearch": {
      const query = stringValue(args.query);
      if (query !== undefined) return { tool: "web_search", args: { query } };
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
