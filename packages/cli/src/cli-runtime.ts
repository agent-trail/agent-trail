import { Command, CommanderError } from "commander";
import type { TrailAdapter } from "./adapters.ts";
import { addAdaptersCommand } from "./adapters-command.ts";
import type { CliResult } from "./command.ts";
import { ConfigError, type ResolvedConfig, resolveConfig } from "./config.ts";
import { addDiscoverCommand } from "./discover.ts";
import { addDoctorCommand } from "./doctor.ts";
import { addExportCommand } from "./export.ts";
import { addListCommand, runListBrowser } from "./list.ts";
import { addLoadCommand } from "./load.ts";
import { addRegisterCommand } from "./register.ts";
import type { SessionBrowserInput } from "./session-browser-state.ts";
import { addShareCommand } from "./share.ts";
import { addStatusCommand } from "./status.ts";
import type { TerminalIo } from "./terminal.ts";
import { addValidateCommand } from "./validate.ts";
import { addVersionCommand, runVersion } from "./version.ts";

type OutputBuffer = {
  stdout: string;
  stderr: string;
};

const GLOBAL_HELP_HINT = "Run `trail <command> --help` for command-specific flags and examples.";
const TTY_BROWSER_HELP_HINT =
  "In a TTY, bare `trail` opens the session browser; run `trail --help` for usage.";

export type RunCliContext = {
  adapters?: readonly TrailAdapter[];
  config?: ResolvedConfig;
  env?: Record<string, string | undefined>;
  projectRoot?: string;
  storeRoot?: string;
  terminal?: TerminalIo;
  runSessionBrowser?: (input: SessionBrowserInput) => Promise<CliResult>;
};

export async function runCli(argv: string[], context: RunCliContext = {}): Promise<CliResult> {
  const effectiveContext = withDefaultTerminal(context);
  const [subcommand, ...rest] = argv;
  if (subcommand === "--version" || subcommand === "-V") {
    return runVersion(rest);
  }

  const output: OutputBuffer = { stdout: "", stderr: "" };
  if (argv.length === 0) {
    if (effectiveContext.terminal?.isTTY === true) {
      const commandContext = await resolveCommandContext(["list"], effectiveContext);
      if ("exitCode" in commandContext) return commandContext;
      return runListBrowser({}, commandContext);
    }
    const program = buildProgram(output, effectiveContext);
    const help = program.helpInformation();
    return {
      exitCode: 0,
      stdout: appendGlobalHelpHints(help),
      stderr: "",
    };
  }

  const commandContext = await resolveCommandContext(argv, effectiveContext);
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

function withDefaultTerminal(context: RunCliContext): RunCliContext {
  if (context.terminal !== undefined) return context;
  return {
    ...context,
    terminal: {
      isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
      stdin: process.stdin,
      stdout: process.stdout,
      width: process.stdout.columns,
      height: process.stdout.rows,
    },
  };
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
  return argv[0] === "discover" || argv[0] === "list" || argv[0] === "status";
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
    .addHelpText("after", `\n${TTY_BROWSER_HELP_HINT}\n${GLOBAL_HELP_HINT}\n`);

  const writeResult = (result: CliResult) => appendCommandResult(result, output);
  addVersionCommand(program, writeResult);
  addValidateCommand(program, writeResult);
  addListCommand(program, writeResult, {
    adapters: context.adapters,
    config: context.config,
    storeRoot: context.storeRoot,
    terminal: context.terminal,
    runSessionBrowser: context.runSessionBrowser,
  });
  addRegisterCommand(program, writeResult);
  addDiscoverCommand(program, writeResult, {
    adapters: context.adapters,
    config: context.config,
  });
  addStatusCommand(program, writeResult, {
    adapters: context.adapters,
    config: context.config,
    projectRoot: context.projectRoot,
    storeRoot: context.storeRoot,
  });
  addAdaptersCommand(program, writeResult, {
    adapters: context.adapters,
  });
  addDoctorCommand(program, writeResult, {
    adapters: context.adapters,
    config: context.config,
    env: context.env,
    projectRoot: context.projectRoot,
    resolveTrailConfig: resolveConfig,
  });
  addShareCommand(program, writeResult, {
    env: context.env,
    projectRoot: context.projectRoot,
    storeRoot: context.storeRoot,
  });
  addLoadCommand(program, writeResult);
  addExportCommand(program, writeResult);

  return program;
}

function appendGlobalHelpHints(help: string): string {
  let output = help;
  if (!output.includes(TTY_BROWSER_HELP_HINT)) output = `${output}\n${TTY_BROWSER_HELP_HINT}`;
  if (!output.includes(GLOBAL_HELP_HINT)) output = `${output}\n${GLOBAL_HELP_HINT}`;
  return output.endsWith("\n") ? output : `${output}\n`;
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
    "status",
    "adapters",
    "doctor",
    "share",
    "load",
    "export",
  ];
}
