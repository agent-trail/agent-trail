import type { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { addExamples, type ResultWriter } from "./command.ts";

const USAGE = "Usage: trail version [--json]";

export function cliVersion(): string {
  return pkg.version;
}

export async function runVersion(
  argv: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (argv.length === 0) {
    return { exitCode: 0, stdout: `${cliVersion()}\n`, stderr: "" };
  }
  if (argv.length === 1 && argv[0] === "--json") {
    return { exitCode: 0, stdout: `${JSON.stringify({ version: cliVersion() })}\n`, stderr: "" };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: `unknown argument: ${argv.join(" ")}\n${USAGE}\n`,
  };
}

export function addVersionCommand(program: Command, writeResult: ResultWriter): void {
  addExamples(
    program
      .command("version")
      .option("--json", "Print version as JSON.", false)
      .description("Print the CLI version.")
      .action(async (options: { json: boolean }) => {
        writeResult(await runVersion(options.json ? ["--json"] : []));
      }),
    ["trail version", "trail version --json"],
  );
}
