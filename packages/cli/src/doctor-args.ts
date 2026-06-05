export const DOCTOR_USAGE = "Usage: trail doctor [--json] [--fix --yes]";

export type ParsedDoctorArgs = {
  fix: boolean;
  json: boolean;
  yes: boolean;
};

export function parseDoctorArgs(argv: string[]): ParsedDoctorArgs | string {
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
