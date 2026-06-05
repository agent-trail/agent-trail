import { type JsonlRecord, parseJsonlString } from "@agent-trail/core";
import { redactTrail } from "@agent-trail/redact";
import type { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { cliDefaultAdapters, type TrailAdapter } from "./adapters.ts";
import { addExamples, type ResultWriter } from "./command.ts";
import {
  ConfigError,
  type ResolvedConfig,
  type resolveConfig,
  type ScaffoldProjectConfigResult,
  scaffoldProjectConfig,
} from "./config.ts";
import { type AdapterStatus, collectAdapterStatuses } from "./status.ts";
import { cliVersion } from "./version.ts";

export type DoctorStatus = "ok" | "warn" | "error";

export type DoctorCheck = {
  id: string;
  status: DoctorStatus;
  label: string;
  message: string;
  details?: Record<string, unknown>;
};

export type DoctorReport = {
  status: DoctorStatus;
  checks: DoctorCheck[];
};

export type RunDoctorResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunDoctorOptions = {
  adapters?: readonly TrailAdapter[];
  bunVersion?: string;
  config?: ResolvedConfig;
  env?: Record<string, string | undefined>;
  projectRoot?: string;
  redactTrail?: (records: JsonlRecord[]) => { records: JsonlRecord[]; summary: unknown };
  resolveTrailConfig?: typeof resolveConfig;
  scaffoldProjectConfig?: typeof scaffoldProjectConfig;
};

const USAGE = "Usage: trail doctor [--json] [--fix --yes]";
const MIN_BUN_VERSION = "1.3.11";

export async function runDoctor(
  argv: string[],
  opts: RunDoctorOptions = {},
): Promise<RunDoctorResult> {
  const parsedArgs = parseDoctorArgs(argv);
  if (typeof parsedArgs === "string") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${parsedArgs}\n${USAGE}\n`,
    };
  }
  if (parsedArgs.fix && !parsedArgs.yes) {
    return { exitCode: 1, stdout: "", stderr: `doctor: --fix requires --yes\n${USAGE}\n` };
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
    stdout: parsedArgs.json ? `${JSON.stringify(report)}\n` : renderText(report),
    stderr: "",
  };
}

type ParsedDoctorArgs = {
  fix: boolean;
  json: boolean;
  yes: boolean;
};

function parseDoctorArgs(argv: string[]): ParsedDoctorArgs | string {
  const parsed: ParsedDoctorArgs = { fix: false, json: false, yes: false };
  for (const arg of argv) {
    if (arg === "--fix") {
      parsed.fix = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--yes") {
      parsed.yes = true;
    } else {
      return `unknown argument: ${arg}`;
    }
  }
  return parsed;
}

function configSourcesCheck(config: ResolvedConfig): DoctorCheck {
  return {
    id: "config.sources",
    status: "ok",
    label: "config sources",
    message: "config layers resolved",
    details: {
      config: config.config,
      sources: config.sources,
    },
  };
}

function configSourcesErrorCheck(error: unknown): DoctorCheck {
  const message =
    error instanceof ConfigError || error instanceof Error ? error.message : String(error);
  return {
    id: "config.sources",
    status: "error",
    label: "config sources",
    message: `config resolution failed: ${message}`,
    details: { error: message },
  };
}

function configScaffoldCheck(result: ScaffoldProjectConfigResult): DoctorCheck {
  const changed = result.created.length + result.updated.length;
  return {
    id: "config.scaffold",
    status: "ok",
    label: "config scaffold",
    message:
      changed === 0
        ? "config scaffold already present"
        : `config scaffold updated ${changed} path${changed === 1 ? "" : "s"}`,
    details: {
      created: result.created,
      existing: result.existing,
      updated: result.updated,
      paths: result.paths,
    },
  };
}

function configScaffoldErrorCheck(error: unknown): DoctorCheck {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: "config.scaffold",
    status: "error",
    label: "config scaffold",
    message: `config scaffold failed: ${message}`,
    details: { error: message },
  };
}

function cliVersionCheck(): DoctorCheck {
  const version = cliVersion();
  return {
    id: "runtime.cli_version",
    status: "ok",
    label: "cli version",
    message: `cli version: trail ${version}`,
    details: { version },
  };
}

function bunRuntimeCheck(version: string): DoctorCheck {
  const ok = compareVersions(version, MIN_BUN_VERSION) >= 0;
  return {
    id: "runtime.bun",
    status: ok ? "ok" : "error",
    label: "bun runtime",
    message: ok
      ? `bun ${version} satisfies >=${MIN_BUN_VERSION}`
      : `bun ${version} is below required >=${MIN_BUN_VERSION}`,
    details: { version, minimum: MIN_BUN_VERSION, engine: pkg.engines.bun },
  };
}

async function redactionCheck(
  redactor: (records: JsonlRecord[]) => { records: JsonlRecord[]; summary: unknown },
): Promise<DoctorCheck> {
  try {
    const records = await parseJsonlString(
      `${JSON.stringify({
        type: "session",
        schema_version: "0.1.0",
        id: "doctor-session",
        ts: "2026-01-01T00:00:00.000Z",
        agent: { name: "doctor" },
      })}\n`,
    );
    redactor(records);
    return {
      id: "redaction.pipeline",
      status: "ok",
      label: "redaction pipeline",
      message: "redaction pipeline loaded",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: "redaction.pipeline",
      status: "error",
      label: "redaction pipeline",
      message: `redaction pipeline failed: ${message}`,
    };
  }
}

async function adapterChecks(adapters: readonly TrailAdapter[]): Promise<DoctorCheck[]> {
  return (await collectAdapterStatuses(adapters)).map(adapterStatusCheck);
}

function adapterStatusCheck(status: AdapterStatus): DoctorCheck {
  const failureMessage = healthCheckFailureMessage(status);
  if (failureMessage !== null) {
    return {
      id: `adapter.${status.adapter}`,
      status: "warn",
      label: status.adapter,
      message: `${status.adapter}: health check failed: ${failureMessage}`,
      details: { adapter: status.adapter, warnings: [failureMessage] },
    };
  }
  const countText = status.session_count === 1 ? "1 session" : `${status.session_count} sessions`;
  return {
    id: `adapter.${status.adapter}`,
    status: status.status,
    label: status.adapter,
    message: `${status.adapter}: ${countText}${status.path === null ? "" : ` at ${status.path}`}`,
    details: {
      adapter: status.adapter,
      path: status.path,
      present: status.present,
      readable: status.readable,
      session_count: status.session_count,
      source_version: status.source_version,
      warnings: status.warnings,
    },
  };
}

function healthCheckFailureMessage(status: AdapterStatus): string | null {
  if (status.warnings.length !== 1) return null;
  const [warning] = status.warnings;
  const prefix = "health check failed: ";
  return warning?.startsWith(prefix) ? warning.slice(prefix.length) : null;
}

function aggregateStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

function renderText(report: DoctorReport): string {
  const runtime = report.checks.filter((check) => check.id.startsWith("runtime."));
  const config = report.checks.filter((check) => check.id.startsWith("config."));
  const redaction = report.checks.filter((check) => check.id.startsWith("redaction."));
  const adapters = report.checks.filter((check) => check.id.startsWith("adapter."));
  const sections = [`status: ${report.status}`, "", "runtime", ...runtime.map(renderCheckLine)];
  if (config.length > 0) {
    sections.push("", "config", ...config.flatMap(renderConfigCheck));
  }
  sections.push(
    "",
    "redaction",
    ...redaction.map(renderCheckLine),
    "",
    "adapters",
    ...adapters.map(renderCheckLine),
  );
  return sections.join("\n").concat("\n");
}

function renderCheckLine(check: DoctorCheck): string {
  return `${check.status}  ${check.message}`;
}

function renderConfigCheck(check: DoctorCheck): string[] {
  const lines = [renderCheckLine(check)];
  if (check.id !== "config.sources") return lines;
  const sources = configSourceDetails(check.details?.sources);
  lines.push(
    ...sources.map(
      (source) =>
        `  - ${source.layer}: ${source.status}${source.path === null ? "" : ` (${source.path})`}`,
    ),
  );
  return lines;
}

function configSourceDetails(value: unknown): Array<{
  layer: string;
  path: string | null;
  status: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((source) => {
    if (typeof source !== "object" || source === null) return [];
    const entry = source as Record<string, unknown>;
    const layer = entry.layer;
    const status = entry.status;
    const path = entry.path;
    if (typeof layer !== "string" || typeof status !== "string") {
      return [];
    }
    if (path !== null && typeof path !== "string") {
      return [];
    }
    return [{ layer, path, status }];
  });
}

function compareVersions(left: string, right: string): number {
  const leftParts = numericParts(left);
  const rightParts = numericParts(right);
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const l = leftParts[i] ?? 0;
    const r = rightParts[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

function numericParts(version: string): number[] {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const core = normalized.split("-")[0] as string;
  return core.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
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
