import { type JsonlRecord, parseJsonlString } from "@agent-trail/core";
import pkg from "../package.json" with { type: "json" };
import type { TrailAdapter } from "./adapters.ts";
import { ConfigError, type ResolvedConfig } from "./config.ts";
import type { ConfigScaffoldResult, DoctorCheck, DoctorStatus } from "./doctor-types.ts";
import { type AdapterStatus, collectAdapterStatuses } from "./status.ts";
import { cliVersion } from "./version.ts";

const MIN_BUN_VERSION = "1.3.11";

export function configSourcesCheck(config: ResolvedConfig): DoctorCheck {
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

export function configSourcesErrorCheck(error: unknown): DoctorCheck {
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

export function configScaffoldCheck(result: ConfigScaffoldResult): DoctorCheck {
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

export function configScaffoldErrorCheck(error: unknown): DoctorCheck {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: "config.scaffold",
    status: "error",
    label: "config scaffold",
    message: `config scaffold failed: ${message}`,
    details: { error: message },
  };
}

export function cliVersionCheck(): DoctorCheck {
  const version = cliVersion();
  return {
    id: "runtime.cli_version",
    status: "ok",
    label: "cli version",
    message: `cli version: trail ${version}`,
    details: { version },
  };
}

export function bunRuntimeCheck(version: string): DoctorCheck {
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

export async function redactionCheck(
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

export async function adapterChecks(adapters: readonly TrailAdapter[]): Promise<DoctorCheck[]> {
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

export function aggregateStatus(checks: DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
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
