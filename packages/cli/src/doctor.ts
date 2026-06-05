import { redactTrail } from "@agent-trail/redact";
import type { Command } from "commander";
import { cliDefaultAdapters } from "./adapters.ts";
import { addExamples, type ResultWriter } from "./command.ts";
import { scaffoldProjectConfig } from "./config.ts";
import { DOCTOR_USAGE, parseDoctorArgs } from "./doctor-args.ts";
import {
  adapterChecks,
  aggregateStatus,
  bunRuntimeCheck,
  cliVersionCheck,
  configScaffoldCheck,
  configScaffoldErrorCheck,
  configSourcesCheck,
  configSourcesErrorCheck,
  redactionCheck,
} from "./doctor-checks.ts";
import { renderDoctorText } from "./doctor-render.ts";
import type {
  DoctorCheck,
  DoctorReport,
  RunDoctorOptions,
  RunDoctorResult,
} from "./doctor-types.ts";

export type {
  DoctorCheck,
  DoctorReport,
  DoctorStatus,
  RunDoctorOptions,
  RunDoctorResult,
} from "./doctor-types.ts";

export async function runDoctor(
  argv: string[],
  opts: RunDoctorOptions = {},
): Promise<RunDoctorResult> {
  const parsedArgs = parseDoctorArgs(argv);
  if (typeof parsedArgs === "string") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${parsedArgs}\n${DOCTOR_USAGE}\n`,
    };
  }
  if (parsedArgs.fix && !parsedArgs.yes) {
    return { exitCode: 1, stdout: "", stderr: `doctor: --fix requires --yes\n${DOCTOR_USAGE}\n` };
  }

  let scaffoldCheck: DoctorCheck | undefined;
  if (parsedArgs.fix && parsedArgs.yes) {
    try {
      scaffoldCheck = configScaffoldCheck(
        await (opts.scaffoldProjectConfig ?? scaffoldProjectConfig)({
          projectRoot: opts.projectRoot,
        }),
      );
    } catch (error) {
      scaffoldCheck = configScaffoldErrorCheck(error);
    }
  }

  const configChecks: DoctorCheck[] = [];
  const resolveTrailConfig = opts.resolveTrailConfig;
  const shouldRefreshConfig =
    parsedArgs.fix &&
    parsedArgs.yes &&
    scaffoldCheck?.status === "ok" &&
    resolveTrailConfig !== undefined;
  if (resolveTrailConfig !== undefined && (shouldRefreshConfig || opts.config === undefined)) {
    try {
      configChecks.push(
        configSourcesCheck(
          await resolveTrailConfig({ env: opts.env, projectRoot: opts.projectRoot }),
        ),
      );
    } catch (error) {
      configChecks.push(configSourcesErrorCheck(error));
    }
  } else if (opts.config !== undefined) {
    configChecks.push(configSourcesCheck(opts.config));
  }

  const checks = [
    cliVersionCheck(),
    bunRuntimeCheck(opts.bunVersion ?? Bun.version),
    ...configChecks,
    ...(scaffoldCheck === undefined ? [] : [scaffoldCheck]),
    await redactionCheck(opts.redactTrail ?? redactTrail),
    ...(await adapterChecks(opts.adapters ?? cliDefaultAdapters())),
  ];
  const report: DoctorReport = { status: aggregateStatus(checks), checks };
  return {
    exitCode: report.status === "error" ? 1 : 0,
    stdout: parsedArgs.json ? `${JSON.stringify(report)}\n` : renderDoctorText(report),
    stderr: "",
  };
}

export function addDoctorCommand(
  program: Command,
  writeResult: ResultWriter,
  context: Pick<
    RunDoctorOptions,
    "adapters" | "config" | "env" | "projectRoot" | "resolveTrailConfig"
  > = {},
): void {
  addExamples(
    program
      .command("doctor")
      .option("--json", "Print health report as JSON.", false)
      .option("--fix", "Create missing project config scaffold.", false)
      .option("--yes", "Confirm --fix without prompting.", false)
      .description("Check CLI and adapter health.")
      .action(async (options: { fix: boolean; json: boolean; yes: boolean }) => {
        const argv = [
          ...(options.json ? ["--json"] : []),
          ...(options.fix ? ["--fix"] : []),
          ...(options.yes ? ["--yes"] : []),
        ];
        writeResult(await runDoctor(argv, context));
      }),
    ["trail doctor", "trail doctor --json", "trail doctor --fix --yes"],
  );
}
