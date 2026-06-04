import { Command, CommanderError } from "commander";
import { runDiscover } from "./discover.ts";
import { runDoctor } from "./doctor.ts";
import { runExport } from "./export.ts";
import { runList } from "./list.ts";
import { runLoad } from "./load.ts";
import { runShare } from "./share.ts";
import { runValidate } from "./validate.ts";
import { runVersion } from "./version.ts";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type Handler = (argv: string[]) => Promise<CliResult>;

type OutputBuffer = {
  stdout: string;
  stderr: string;
};

const handlers: Record<string, Handler> = {
  validate: runValidate,
  list: runList,
  discover: runDiscover,
  doctor: runDoctor,
  share: runShare,
  load: runLoad,
  export: runExport,
};

export async function runCli(argv: string[]): Promise<CliResult> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "--version" || subcommand === "-V" || subcommand === "version") {
    return runVersion(rest);
  }

  const output: OutputBuffer = { stdout: "", stderr: "" };
  const program = buildProgram(output);

  try {
    await program.parseAsync(argv, { from: "user" });
    return { exitCode: 0, stdout: output.stdout, stderr: output.stderr };
  } catch (error) {
    if (error instanceof CommanderError) {
      return {
        exitCode: error.exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
      };
    }
    throw error;
  }
}

function buildProgram(output: OutputBuffer): Command {
  const program = new Command("trail");
  program
    .exitOverride()
    .showHelpAfterError()
    .configureOutput({
      writeOut: (value) => {
        output.stdout += value;
      },
      writeErr: (value) => {
        output.stderr += value;
      },
    });

  program.description("Agent Trail command-line interface.");

  program
    .command("validate")
    .argument("[args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("Validate a Trail file.")
    .action(commandAction(runValidate, output));

  program
    .command("list")
    .argument("[args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("List locally stored Trail objects.")
    .action(commandAction(runList, output));

  program
    .command("discover")
    .argument("[args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("Discover source-agent sessions.")
    .action(commandAction(runDiscover, output));

  program
    .command("doctor")
    .argument("[args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("Check CLI and adapter health.")
    .action(commandAction(runDoctor, output));

  program
    .command("share")
    .argument("[args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("Redact and share a Trail file.")
    .action(commandAction(runShare, output));

  program
    .command("load")
    .argument("[args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("Load a shared Trail file.")
    .action(commandAction(runLoad, output));

  program
    .command("export")
    .argument("[args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("Export a local Trail object.")
    .action(commandAction(runExport, output));

  return program;
}

function commandAction(handler: Handler, output: OutputBuffer): (args: string[]) => Promise<void> {
  return async (args) => {
    const result = await handler(args);
    output.stdout += result.stdout;
    output.stderr += result.stderr;
    if (result.exitCode !== 0) {
      throw new CommanderError(result.exitCode, "command.failed", "");
    }
  };
}

export function commandNames(): string[] {
  return Object.keys(handlers);
}
