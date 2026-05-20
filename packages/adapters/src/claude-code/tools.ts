import { isObject, jsonObjectValue, jsonString, maybeNumber, stringValue } from "./source.ts";

export function toolKindAndArgs(
  name: string | undefined,
  input: unknown,
): {
  tool: string;
  args: object;
} {
  const args = jsonObjectValue(input) ?? {};
  switch (name) {
    case "Bash": {
      const command = stringValue(args.command);
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
    case "Read": {
      const path = stringValue(args.file_path) ?? stringValue(args.path);
      if (path !== undefined) return { tool: "file_read", args: { path } };
      break;
    }
    case "Write": {
      const path = stringValue(args.file_path) ?? stringValue(args.path);
      const content = stringValue(args.content);
      if (path !== undefined && content !== undefined)
        return { tool: "file_write", args: { path, content } };
      break;
    }
    case "Edit": {
      const path = stringValue(args.file_path) ?? stringValue(args.path);
      const oldString = stringValue(args.old_string);
      const newString = stringValue(args.new_string);
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
    case "NotebookEdit": {
      const path =
        stringValue(args.notebook_path) ?? stringValue(args.file_path) ?? stringValue(args.path);
      if (path !== undefined) {
        return {
          tool: "notebook_edit",
          args: {
            path,
            ...(stringValue(args.cell_id) !== undefined
              ? { cell_id: stringValue(args.cell_id) }
              : {}),
            ...(stringValue(args.new_source) !== undefined
              ? { content: stringValue(args.new_source) }
              : {}),
          },
        };
      }
      break;
    }
    case "Grep": {
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
    case "Glob": {
      const pattern = stringValue(args.pattern);
      if (pattern !== undefined)
        return { tool: "file_search", args: { query: pattern, glob: pattern } };
      break;
    }
    case "WebFetch": {
      const url = stringValue(args.url);
      if (url !== undefined) return { tool: "web_fetch", args: { url } };
      break;
    }
    case "WebSearch": {
      const query = stringValue(args.query);
      if (query !== undefined) return { tool: "web_search", args: { query } };
      break;
    }
    case "TodoWrite": {
      return {
        tool: "task_plan",
        args: { ...(Array.isArray(args.todos) ? { items: args.todos.map(jsonString) } : {}) },
      };
    }
    case "Task": {
      const task =
        stringValue(args.prompt) ?? stringValue(args.description) ?? stringValue(args.name);
      if (task !== undefined) {
        return {
          tool: "subagent_invoke",
          args: {
            task,
            ...(stringValue(args.subagent_type) !== undefined
              ? { agent_type: stringValue(args.subagent_type) }
              : {}),
            ...(stringValue(args.session_id) !== undefined
              ? { session_id: stringValue(args.session_id) }
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
