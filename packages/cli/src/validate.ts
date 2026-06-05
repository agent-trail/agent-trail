import {
  formatDiagnosticsJsonValue,
  formatDiagnosticsText,
  resolveValidationProfile,
  type ValidationProfile,
  validateTrailStream,
} from "@agent-trail/core";
import type { Command } from "commander";
import { addExamples, type ResultWriter } from "./command.ts";

export type RunValidateResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunValidateOptions = {
  file: string;
  json?: boolean;
  profile?: string;
};

export async function runValidate(options: RunValidateOptions): Promise<RunValidateResult> {
  let profile: ValidationProfile;
  try {
    profile = resolveValidationProfile(options.profile ?? "strict");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }

  const path = options.file;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { exitCode: 1, stdout: "", stderr: `file not found: ${path}\n` };
  }

  const diagnostics = [];
  for await (const diagnostic of validateTrailStream(file.stream(), { profile })) {
    diagnostics.push(diagnostic);
  }

  const hasError = diagnostics.some((d) => d.severity === "error");
  const stdout = options.json
    ? `${JSON.stringify(formatDiagnosticsJsonValue(diagnostics))}\n`
    : diagnostics.length === 0
      ? ""
      : `${formatDiagnosticsText(diagnostics)}\n`;

  return { exitCode: hasError ? 1 : 0, stdout, stderr: "" };
}

export function addValidateCommand(program: Command, writeResult: ResultWriter): void {
  addExamples(
    program
      .command("validate")
      .argument("<file>")
      .option("--json", "Print diagnostics as JSON.", false)
      .option("--profile <profile>", "Validation profile.", "strict")
      .description("Validate a Trail file.")
      .action(async (file: string, options: { json: boolean; profile: string }) => {
        writeResult(await runValidate({ file, json: options.json, profile: options.profile }));
      }),
    ["trail validate session.trail.jsonl", "trail validate session.trail.jsonl --profile reader"],
  );
}
