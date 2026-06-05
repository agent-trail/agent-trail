import type { ToolKind } from "@agent-trail/types";
import { numberValue, type Raw, stringValue } from "./source.ts";

export function mapTool(toolName: string, args: Raw): { tool: ToolKind; args: Raw } {
  switch (toolName) {
    case "read": {
      const path =
        stringValue(args.filePath) ?? stringValue(args.file_path) ?? stringValue(args.path);
      const offset = numberValue(args.offset);
      const limit = numberValue(args.limit);
      if (path === undefined) return { tool: "other", args: { name: toolName, args } };
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
    case "write": {
      const path = stringValue(args.filePath) ?? stringValue(args.path);
      const content = stringValue(args.content);
      if (path === undefined || content === undefined)
        return { tool: "other", args: { name: toolName, args } };
      return {
        tool: "file_write",
        args: { path, content },
      };
    }
    case "edit": {
      const path = stringValue(args.filePath) ?? stringValue(args.path);
      if (path === undefined) return { tool: "other", args: { name: toolName, args } };
      const oldString = stringValue(args.oldString) ?? stringValue(args.old_string) ?? "";
      const newString = stringValue(args.newString) ?? stringValue(args.new_string) ?? "";
      const diff = `--- a/${path}\n+++ b/${path}\n@@\n-${oldString}\n+${newString}`;
      return {
        tool: "file_edit",
        args: { path, diff },
      };
    }
    case "bash": {
      return {
        tool: "shell_command",
        args: {
          ...(stringValue(args.command) !== undefined
            ? { command: stringValue(args.command) }
            : {}),
          ...(stringValue(args.workdir) !== undefined ? { cwd: stringValue(args.workdir) } : {}),
          ...(numberValue(args.timeout) !== undefined
            ? { timeout: numberValue(args.timeout) }
            : {}),
        },
      };
    }
    case "background_output": {
      const commandId =
        stringValue(args.commandID) ?? stringValue(args.command_id) ?? stringValue(args.id);
      return {
        tool: "shell_output",
        args: { ...(commandId !== undefined ? { command_id: commandId } : {}) },
      };
    }
    case "grep":
      return {
        tool: "file_search",
        args: {
          query: stringValue(args.pattern) ?? "",
          ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
          ...(stringValue(args.include) !== undefined ? { glob: stringValue(args.include) } : {}),
        },
      };
    case "glob": {
      return {
        tool: "file_search",
        args: {
          query: stringValue(args.pattern) ?? "",
          ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
        },
      };
    }
    case "list": {
      const path = stringValue(args.path) ?? ".";
      return { tool: "file_list", args: { path } };
    }
    case "webfetch": {
      const url = stringValue(args.url)?.trim();
      if (url === undefined || url.length === 0) {
        return { tool: "other", args: { name: "webfetch", args } };
      }
      return {
        tool: "web_fetch",
        args: { url },
      };
    }
    case "task": {
      return {
        tool: "subagent_invoke",
        args: {
          task: stringValue(args.prompt) ?? stringValue(args.description) ?? "",
          ...(stringValue(args.subagent_type) !== undefined
            ? { agent_type: stringValue(args.subagent_type) }
            : {}),
        },
      };
    }
    default:
      if (/^[a-z0-9-]+_[a-z0-9][a-z0-9_-]*$/i.test(toolName)) {
        const [server, ...toolParts] = toolName.split("_");
        return {
          tool: "mcp_call",
          args: { server: server!, tool: toolParts.join("-"), args },
        };
      }
      return { tool: "other", args: { name: toolName, args } };
  }
}
