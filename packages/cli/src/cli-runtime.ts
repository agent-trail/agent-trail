import { Command, CommanderError } from "commander";
import type { CliResult } from "./command.ts";
import { addDiscoverCommand } from "./discover.ts";
import { addDoctorCommand } from "./doctor.ts";
import { addExportCommand } from "./export.ts";
import { addListCommand } from "./list.ts";
import { addLoadCommand } from "./load.ts";
import { addRegisterCommand } from "./register.ts";
import { addShareCommand } from "./share.ts";
import { addValidateCommand } from "./validate.ts";
import { addVersionCommand, runVersion } from "./version.ts";

type OutputBuffer = {
  stdout: string;
  stderr: string;
};

const GLOBAL_HELP_HINT = "Run `trail <command> --help` for command-specific flags and examples.";

export async function runCli(argv: string[]): Promise<CliResult> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "--version" || subcommand === "-V") {
    return runVersion(rest);
  }

  const output: OutputBuffer = { stdout: "", stderr: "" };
  const program = buildProgram(output);
  if (argv.length === 0) {
    const help = program.helpInformation();
    return {
      exitCode: 0,
      stdout: help.includes(GLOBAL_HELP_HINT) ? help : `${help}\n${GLOBAL_HELP_HINT}\n`,
      stderr: "",
    };
  }

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

  program
    .description("Agent Trail command-line interface.")
    .addHelpText("after", `\n${GLOBAL_HELP_HINT}\n`);

  const writeResult = (result: CliResult) => appendCommandResult(result, output);
  addVersionCommand(program, writeResult);
  addValidateCommand(program, writeResult);
  addListCommand(program, writeResult);
  addRegisterCommand(program, writeResult);
  addDiscoverCommand(program, writeResult);
  addDoctorCommand(program, writeResult);
  addShareCommand(program, writeResult);
  addLoadCommand(program, writeResult);
  addExportCommand(program, writeResult);

  return program;
}

function appendCommandResult(result: CliResult, output: OutputBuffer): void {
  output.stdout += result.stdout;
  output.stderr += result.stderr;
  if (result.exitCode !== 0) {
    throw new CommanderError(result.exitCode, "command.failed", "");
  }
}

export function commandNames(): string[] {
  return [
    "version",
    "validate",
    "list",
    "register",
    "discover",
    "doctor",
    "share",
    "load",
    "export",
  ];
}
