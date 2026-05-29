import { stringValue } from "./guards.ts";
import { quoteShellArg } from "./shell.ts";

// Extracts a canonical shell command string from tool args. Tries a `command`
// string, then a `cmd` string, then an argv-style `command` array (quoted and
// joined). Refuses a partial argv array (any non-string element) rather than
// reconstruct a command the source never expressed.
export function commandFrom(args: Record<string, unknown>): string | undefined {
  const command = stringValue(args.command);
  if (command !== undefined) return command;
  const cmd = stringValue(args.cmd);
  if (cmd !== undefined) return cmd;
  const argv = args.command;
  if (Array.isArray(argv)) {
    const parts = argv.filter((p): p is string => typeof p === "string");
    if (parts.length === 0 || parts.length !== argv.length) return undefined;
    return parts.map(quoteShellArg).join(" ");
  }
  return undefined;
}

// Extracts a file path from tool args, preferring `file_path` over `path`.
export function filePathFrom(args: Record<string, unknown>): string | undefined {
  return stringValue(args.file_path) ?? stringValue(args.path);
}
