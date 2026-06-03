import { isObject, jsonObjectValue, maybeNumber, stringValue } from "./source.ts";

const AGENT_TRAIL_ID_RE =
  /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/;

function agentTrailId(value: unknown): string | undefined {
  const id = stringValue(value);
  return id !== undefined && AGENT_TRAIL_ID_RE.test(id) ? id : undefined;
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
    case "ToolSearch": {
      const query = stringValue(args.query) ?? stringValue(args.q);
      if (query !== undefined) {
        return {
          tool: "tool_search",
          args: {
            query,
            ...(maybeNumber(args.limit) !== undefined ? { limit: maybeNumber(args.limit) } : {}),
          },
        };
      }
      break;
    }
    case "Task":
    case "Agent": {
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
            ...(agentTrailId(args.session_id) !== undefined
              ? { session_id: agentTrailId(args.session_id) }
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
