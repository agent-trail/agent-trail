import type { JsonlRecord } from "@agent-trail/core";
import type { TrailAdapter } from "./adapters.ts";
import type {
  ResolvedConfig,
  resolveConfig,
  ScaffoldProjectConfigResult,
  scaffoldProjectConfig,
} from "./config.ts";

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

export type ConfigScaffoldResult = ScaffoldProjectConfigResult;
