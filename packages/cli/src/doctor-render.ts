import type { DoctorCheck, DoctorReport } from "./doctor-types.ts";

export function renderDoctorText(report: DoctorReport): string {
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
