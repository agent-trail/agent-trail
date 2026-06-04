#!/usr/bin/env bun
import { runCli } from "./cli-runtime.ts";

try {
  const { exitCode, stdout, stderr } = await runCli(Bun.argv.slice(2));
  if (stdout.length > 0) await Bun.write(Bun.stdout, stdout);
  if (stderr.length > 0) await Bun.write(Bun.stderr, stderr);
  process.exit(exitCode);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await Bun.write(Bun.stderr, `${message}\n`);
  process.exit(2);
}
