import type { Command } from "commander";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ResultWriter = (result: CliResult) => void;

export function addExamples(command: Command, examples: string[]): Command {
  return command.addHelpText(
    "after",
    `\nExamples:\n${examples.map((example) => `  ${example}`).join("\n")}\n`,
  );
}
