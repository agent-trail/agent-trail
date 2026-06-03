import {
  claudeCodeAdapter,
  codexAdapter,
  piAdapter,
  type TrailAdapter,
} from "@agent-trail/adapters";
import { type JsonlRecord, parseJsonlString } from "@agent-trail/core";
import { redactTrail } from "@agent-trail/redact";
import pkg from "../package.json" with { type: "json" };
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
  adapters?: TrailAdapter[];
  bunVersion?: string;
  redactTrail?: (records: JsonlRecord[]) => { records: JsonlRecord[]; summary: unknown };
};

const USAGE = "Usage: trail doctor [--json]";
const DEFAULT_ADAPTERS: TrailAdapter[] = [claudeCodeAdapter, codexAdapter, piAdapter];
const MIN_BUN_VERSION = "1.3.11";

export async function runDoctor(
  argv: string[],
  opts: RunDoctorOptions = {},
): Promise<RunDoctorResult> {
  const json = argv.length === 1 && argv[0] === "--json";
  if (argv.length > 1 || (argv.length === 1 && !json)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `unknown argument: ${argv.join(" ")}\n${USAGE}\n`,
    };
  }

  const checks = [
    cliVersionCheck(),
    bunRuntimeCheck(opts.bunVersion ?? Bun.version),
    await redactionCheck(opts.redactTrail ?? redactTrail),
    ...(await adapterChecks(opts.adapters ?? DEFAULT_ADAPTERS)),
  ];
  const report: DoctorReport = { status: aggregateStatus(checks), checks };
  return {
    exitCode: report.status === "error" ? 1 : 0,
    stdout: json ? `${JSON.stringify(report)}\n` : renderText(report),
    stderr: "",
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

async function adapterChecks(adapters: TrailAdapter[]): Promise<DoctorCheck[]> {
  return Promise.all(
    adapters.map(async (adapter): Promise<DoctorCheck> => {
      try {
        const health = await adapter.sourceHealth();
        const status: DoctorStatus =
          health.present && health.readable && health.warnings.length === 0 ? "ok" : "warn";
        const countText =
          health.sessionCount === 1 ? "1 session" : `${health.sessionCount} sessions`;
        return {
          id: `adapter.${adapter.name}`,
          status,
          label: adapter.name,
          message: `${adapter.name}: ${countText}${
            health.path === null ? "" : ` at ${health.path}`
          }`,
          details: {
            adapter: health.adapter,
            path: health.path,
            present: health.present,
            readable: health.readable,
            session_count: health.sessionCount,
            source_version: health.sourceVersion,
            warnings: health.warnings,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          id: `adapter.${adapter.name}`,
          status: "warn",
          label: adapter.name,
          message: `${adapter.name}: health check failed: ${message}`,
          details: { adapter: adapter.name, warnings: [message] },
        };
      }
    }),
  );
}

function aggregateStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

function renderText(report: DoctorReport): string {
  const runtime = report.checks.filter((check) => check.id.startsWith("runtime."));
  const redaction = report.checks.filter((check) => check.id.startsWith("redaction."));
  const adapters = report.checks.filter((check) => check.id.startsWith("adapter."));
  return [
    `status: ${report.status}`,
    "",
    "runtime",
    ...runtime.map(renderCheckLine),
    "",
    "redaction",
    ...redaction.map(renderCheckLine),
    "",
    "adapters",
    ...adapters.map(renderCheckLine),
  ]
    .join("\n")
    .concat("\n");
}

function renderCheckLine(check: DoctorCheck): string {
  return `${check.status}  ${check.message}`;
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
  const core = version.split("-")[0] ?? version;
  return core.split(".").map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  });
}
