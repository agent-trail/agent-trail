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
