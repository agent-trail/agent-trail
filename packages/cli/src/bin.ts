#!/usr/bin/env bun
import { runDiscover } from "./discover.ts";
import { runDoctor } from "./doctor.ts";
import { runExport } from "./export.ts";
import { runList } from "./list.ts";
import { runLoad } from "./load.ts";
import { runShare } from "./share.ts";
import { runValidate } from "./validate.ts";
import { runVersion } from "./version.ts";

const USAGE = `Usage:
  trail validate <file> [--json] [--profile strict|reader-tolerant]
  trail list [--json] [--agent <name>] [--cwd <path>] [--since <iso>] [--until <iso>]
  trail discover [--json] [--all] [--agent <name>] [--cwd <path>] [--since <iso>] [--until <iso>]
  trail doctor [--json]
  trail share <path> [--dry-run] [--yes] [--skip-redaction]
  trail load <url> [--out <path>] [--force]
  trail export <id> [--out <path>] [--force]
  trail version [--json]
  trail --version | -V [--json]
`;

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

if (subcommand === "--version" || subcommand === "-V" || subcommand === "version") {
  const { exitCode, stdout, stderr } = await runVersion(rest);
  if (stdout.length > 0) await Bun.write(Bun.stdout, stdout);
  if (stderr.length > 0) await Bun.write(Bun.stderr, stderr);
  process.exit(exitCode);
}

type Handler = (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

// Null-prototype map so inherited keys (`toString`, `constructor`, ...) cannot
// satisfy the lookup and slip into the dispatch path as a non-command.
const handlers: Record<string, Handler> = Object.assign(Object.create(null), {
  validate: runValidate,
  list: runList,
  discover: runDiscover,
  doctor: runDoctor,
  share: runShare,
  load: runLoad,
  export: runExport,
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
