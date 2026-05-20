import { parseArgs } from "node:util";
import {
  formatDiagnosticsJsonValue,
  formatDiagnosticsText,
  resolveValidationProfile,
  type ValidationProfile,
  validateTrailStream,
} from "@agent-trail/core";

export type RunValidateResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const USAGE = "Usage: trail validate <file> [--json] [--profile strict|reader-tolerant]";

export async function runValidate(argv: string[]): Promise<RunValidateResult> {
  const parseConfig = {
    args: argv,
    options: {
      json: { type: "boolean", default: false },
      profile: { type: "string", default: "strict" },
    },
    allowPositionals: true,
  } as const;

  let values: { json: boolean; profile: string };
  let positionals: string[];
  try {
    const parsed = parseArgs(parseConfig);
    values = parsed.values as { json: boolean; profile: string };
    positionals = parsed.positionals;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n${USAGE}\n` };
  }

  let profile: ValidationProfile;
  try {
    profile = resolveValidationProfile(values.profile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }

  const path = positionals[0];
  if (path === undefined) {
    return { exitCode: 1, stdout: "", stderr: `missing required argument: <file>\n${USAGE}\n` };
  }
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { exitCode: 1, stdout: "", stderr: `file not found: ${path}\n` };
  }

  const diagnostics = [];
  for await (const diagnostic of validateTrailStream(file.stream(), { profile })) {
    diagnostics.push(diagnostic);
  }

  const hasError = diagnostics.some((d) => d.severity === "error");
  const stdout = values.json
    ? `${JSON.stringify(formatDiagnosticsJsonValue(diagnostics))}\n`
    : diagnostics.length === 0
      ? ""
      : `${formatDiagnosticsText(diagnostics)}\n`;

  return { exitCode: hasError ? 1 : 0, stdout, stderr: "" };
}
