#!/usr/bin/env bun
import { runValidate } from "./validate.ts";

const [subcommand, ...rest] = Bun.argv.slice(2);

if (subcommand !== "validate") {
  await Bun.write(
    Bun.stderr,
    "Usage: trail validate <file> [--json] [--profile strict|reader-tolerant]\n",
  );
  process.exit(1);
}

try {
  const { exitCode, stdout, stderr } = await runValidate(rest);
  if (stdout.length > 0) await Bun.write(Bun.stdout, stdout);
  if (stderr.length > 0) await Bun.write(Bun.stderr, stderr);
  process.exit(exitCode);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await Bun.write(Bun.stderr, `${message}\n`);
  process.exit(2);
}
