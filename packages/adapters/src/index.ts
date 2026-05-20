import { type Diagnostic, type ValidationProfile, validateTrailString } from "@agent-trail/core";
import type { Entry, Header } from "@agent-trail/types";

export type { Diagnostic, ValidationProfile } from "@agent-trail/core";

export type TrailFile = { header: Header; entries: Entry[] };

export type SessionRef = {
  id: string;
  adapter: string;
  path?: string;
};

export type DetectOptions = {
  cwd?: string;
  since?: string;
};

export interface TrailAdapter {
  readonly name: string;
  detectSessions(opts?: DetectOptions): Promise<SessionRef[]>;
  parseSession(ref: SessionRef): Promise<TrailFile>;
  isAvailable(): Promise<boolean>;
  sourceVersion(): Promise<string | null>;
}

export type ValidateAdapterTrailOptions = { profile?: ValidationProfile };

export { claudeCodeAdapter } from "./claude-code/index.ts";

export async function validateAdapterTrail(
  trail: TrailFile,
  options: ValidateAdapterTrailOptions = {},
): Promise<Diagnostic[]> {
  const lines = [trail.header, ...trail.entries].map((record) => JSON.stringify(record));
  return validateTrailString(`${lines.join("\n")}\n`, { profile: options.profile });
}
