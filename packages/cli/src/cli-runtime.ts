import { Command, CommanderError } from "commander";
import type { TrailAdapter } from "./adapters.ts";
import type { CliResult } from "./command.ts";
import { ConfigError, type ResolvedConfig, resolveConfig } from "./config.ts";
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

export type RunCliContext = {
  adapters?: readonly TrailAdapter[];
  config?: ResolvedConfig;
  env?: Record<string, string | undefined>;
  projectRoot?: string;
  storeRoot?: string;
};

export async function runCli(argv: string[], context: RunCliContext = {}): Promise<CliResult> {
  const [subcommand, ...rest] = argv;
  if (subcommand === "--version" || subcommand === "-V") {
    return runVersion(rest);
  }

  const output: OutputBuffer = { stdout: "", stderr: "" };
  if (argv.length === 0) {
    const program = buildProgram(output, context);
    const help = program.helpInformation();
    return {
      exitCode: 0,
      stdout: help.includes(GLOBAL_HELP_HINT) ? help : `${help}\n${GLOBAL_HELP_HINT}\n`,
      stderr: "",
    };
  }

  const commandContext = await resolveCommandContext(argv, context);
  if ("exitCode" in commandContext) return commandContext;
  const program = buildProgram(output, commandContext);

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

async function resolveCommandContext(
  argv: string[],
  context: RunCliContext,
): Promise<RunCliContext | CliResult> {
  if (isHelpRequest(argv)) return context;
  if (context.config !== undefined) return context;
  if (!usesResolvedConfig(argv)) return context;
  try {
    return {
      ...context,
      config: await resolveConfig({ env: context.env, projectRoot: context.projectRoot }),
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
    }
    throw error;
  }
}

function isHelpRequest(argv: string[]): boolean {
  return argv[0] === "help" || argv.includes("--help") || argv.includes("-h");
}

function usesResolvedConfig(argv: string[]): boolean {
  return argv[0] === "discover" || argv[0] === "list";
}

function buildProgram(output: OutputBuffer, context: RunCliContext): Command {
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
  addListCommand(program, writeResult, { config: context.config, storeRoot: context.storeRoot });
  addRegisterCommand(program, writeResult);
  addDiscoverCommand(program, writeResult, {
    adapters: context.adapters,
    config: context.config,
  });
  addDoctorCommand(program, writeResult, {
    adapters: context.adapters,
    config: context.config,
    env: context.env,
    projectRoot: context.projectRoot,
    resolveTrailConfig: resolveConfig,
  });
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
