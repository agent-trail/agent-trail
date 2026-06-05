import type { Command } from "commander";
import { cliDefaultAdapters, type TrailAdapter } from "./adapters.ts";
import { addExamples, type ResultWriter } from "./command.ts";
import { type AdapterStatus, collectAdapterStatuses, escapeStatusTextSegment } from "./status.ts";

export type RunAdaptersOptions = {
  json?: boolean;
};

export type RunAdaptersContext = {
  adapters?: readonly TrailAdapter[];
};

export type RunAdaptersResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runAdapters(
  options: RunAdaptersOptions = {},
  context: RunAdaptersContext = {},
): Promise<RunAdaptersResult> {
  const statuses = await collectAdapterStatuses(context.adapters ?? cliDefaultAdapters());
  return {
    exitCode: 0,
    stdout: options.json === true ? `${JSON.stringify(statuses)}\n` : renderAdaptersText(statuses),
    stderr: "",
  };
}

function renderAdaptersText(statuses: AdapterStatus[]): string {
  if (statuses.length === 0) return "";
  return `${statuses
    .flatMap((adapter) => [
      `${adapter.status}  ${escapeStatusTextSegment(adapter.adapter)}  ${adapter.session_count} sessions${
        adapter.path === null ? "" : `  ${escapeStatusTextSegment(adapter.path)}`
      }`,
      ...adapter.warnings.map(
        (warning) =>
          `warning: ${escapeStatusTextSegment(adapter.adapter)}: ${escapeStatusTextSegment(warning)}`,
      ),
    ])
    .join("\n")}\n`;
}

export function addAdaptersCommand(
  program: Command,
  writeResult: ResultWriter,
  context: RunAdaptersContext = {},
): void {
  const adapters = program.command("adapters").description("Inspect source-agent adapters.");
  addExamples(
    adapters
      .command("list")
      .option("--json", "Print adapter statuses as JSON.", false)
      .description("List source-agent adapters.")
      .action(async (options: RunAdaptersOptions) => {
        writeResult(await runAdapters(options, context));
      }),
    ["trail adapters list", "trail adapters list --json"],
  );
  addExamples(
    adapters
      .command("status")
      .option("--json", "Print adapter statuses as JSON.", false)
      .description("Show source-agent adapter health.")
      .action(async (options: RunAdaptersOptions) => {
        writeResult(await runAdapters(options, context));
      }),
    ["trail adapters status", "trail adapters status --json"],
  );
}
