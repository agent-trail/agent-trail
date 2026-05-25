#!/usr/bin/env bun
import { runList } from "./list.ts";
import { runLoad } from "./load.ts";
import { runShare } from "./share.ts";
import { runValidate } from "./validate.ts";

const USAGE =
  "Usage:\n  trail validate <file> [--json] [--profile strict|reader-tolerant]\n  trail list [--json] [--agent <name>] [--cwd <path>] [--since <iso>] [--until <iso>]\n  trail share <path> [--dry-run] [--yes] [--skip-redaction]\n  trail load <url> [--out <path>] [--force]\n";

const [subcommand, ...rest] = Bun.argv.slice(2);

if (
  subcommand === undefined ||
  subcommand === "help" ||
  subcommand === "--help" ||
  subcommand === "-h"
) {
  await Bun.write(Bun.stdout, USAGE);
  process.exit(0);
}

type Handler = (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

// Null-prototype map so inherited keys (`toString`, `constructor`, ...) cannot
// satisfy the lookup and slip into the dispatch path as a non-command.
const handlers: Record<string, Handler> = Object.assign(Object.create(null), {
  validate: runValidate,
  list: runList,
  share: runShare,
  load: runLoad,
}) as Record<string, Handler>;

if (!Object.hasOwn(handlers, subcommand)) {
  await Bun.write(Bun.stderr, USAGE);
  process.exit(1);
}
const handler = handlers[subcommand] as Handler;

try {
  const { exitCode, stdout, stderr } = await handler(rest);
  if (stdout.length > 0) await Bun.write(Bun.stdout, stdout);
  if (stderr.length > 0) await Bun.write(Bun.stderr, stderr);
  process.exit(exitCode);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await Bun.write(Bun.stderr, `${message}\n`);
  process.exit(2);
}
