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
  doctor: runDoctor,
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
    .argument("<file>")
    .option("--json", "Print diagnostics as JSON.", false)
    .option("--profile <profile>", "Validation profile.", "strict")
    .description("Validate a Trail file.")
    .action(async (file: string, options: { json: boolean; profile: string }) => {
      const result = await runValidate({ file, json: options.json, profile: options.profile });
      appendCommandResult(result, output);
    });

  program
    .command("list")
    .option("--json", "Print entries as JSON.", false)
    .option("--agent <name>", "Filter by agent name.")
    .option("--cwd <path>", "Filter by cwd.")
    .option("--since <iso>", "Include entries registered at or after this time.")
    .option("--until <iso>", "Include entries registered before this time.")
    .option("--kind <kind>", "Filter by row kind: session or trail.")
    .description("List locally stored Trail objects.")
    .action(
      async (options: {
        json: boolean;
        agent?: string;
        cwd?: string;
        since?: string;
        until?: string;
        kind?: string;
      }) => {
        const result = await runList(options);
        appendCommandResult(result, output);
      },
    );

  program
    .command("discover")
    .option("--json", "Print sessions as JSON.", false)
    .option("--all", "Discover sessions across all known cwd roots.", false)
    .option("--agent <name>", "Filter by adapter name.")
    .option("--cwd <path>", "Discover sessions for a cwd.")
    .option("--since <iso>", "Include sessions modified at or after this time.")
    .option("--until <iso>", "Include sessions modified before this time.")
    .description("Discover source-agent sessions.")
    .action(
      async (options: {
        json: boolean;
        all: boolean;
        agent?: string;
        cwd?: string;
        since?: string;
        until?: string;
      }) => {
        const result = await runDiscover(options);
        appendCommandResult(result, output);
      },
    );

  program
    .command("doctor")
    .argument("[args...]")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .description("Check CLI and adapter health.")
    .action(commandAction(runDoctor, output));

  program
    .command("share")
    .argument("<path>")
    .option("--dry-run", "Register and redact without uploading.", false)
    .option("-y, --yes", "Bypass confirmation prompts.", false)
    .option("--skip-redaction", "Share raw unredacted trail content.", false)
    .option("--keep-remote-url", "Preserve vcs.remote_url in shared content.", false)
    .description("Redact and share a Trail file.")
    .action(
      async (
        path: string,
        options: {
          dryRun: boolean;
          yes: boolean;
          skipRedaction: boolean;
          keepRemoteUrl: boolean;
        },
      ) => {
        const result = await runShare({
          path,
          dryRun: options.dryRun,
          yes: options.yes,
          skipRedaction: options.skipRedaction,
          keepRemoteUrl: options.keepRemoteUrl,
        });
        appendCommandResult(result, output);
      },
    );

  program
    .command("load")
    .argument("<url>")
    .option("--out <path>", "Write canonical loaded bytes to a file.")
    .option("--force", "Overwrite --out when it already exists.", false)
    .description("Load a shared Trail file.")
    .action(async (url: string, options: { out?: string; force: boolean }) => {
      const result = await runLoad({ url, out: options.out, force: options.force });
      appendCommandResult(result, output);
    });

  program
    .command("export")
    .argument("<id>")
    .option("--out <path>", "Write exported bytes to a file.")
    .option("--force", "Overwrite --out when it already exists.", false)
    .description("Export a local Trail object.")
    .action(async (id: string, options: { out?: string; force: boolean }) => {
      const result = await runExport({ id, out: options.out, force: options.force });
      appendCommandResult(result, output);
    });

  return program;
}

function commandAction(handler: Handler, output: OutputBuffer): (args: string[]) => Promise<void> {
  return async (args) => {
    const result = await handler(args);
    appendCommandResult(result, output);
  };
}

function appendCommandResult(result: CliResult, output: OutputBuffer): void {
  output.stdout += result.stdout;
  output.stderr += result.stderr;
  if (result.exitCode !== 0) {
    throw new CommanderError(result.exitCode, "command.failed", "");
  }
}

export function commandNames(): string[] {
  return ["validate", "list", "discover", "share", "load", "export", ...Object.keys(handlers)];
}
