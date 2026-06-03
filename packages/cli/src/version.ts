import pkg from "../package.json" with { type: "json" };

const USAGE = "Usage: trail version [--json]";

export function cliVersion(): string {
  return pkg.version;
}

export async function runVersion(
  argv: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (argv.length === 0) {
    return { exitCode: 0, stdout: `${cliVersion()}\n`, stderr: "" };
  }
  if (argv.length === 1 && argv[0] === "--json") {
    return { exitCode: 0, stdout: `${JSON.stringify({ version: cliVersion() })}\n`, stderr: "" };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: `unknown argument: ${argv.join(" ")}\n${USAGE}\n`,
  };
}
