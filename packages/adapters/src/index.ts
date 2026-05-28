import { type Diagnostic, type ValidationProfile, validateTrailString } from "@agent-trail/core";
import type { Entry, Header, TrailEnvelope } from "@agent-trail/types";

export type { Diagnostic, ValidationProfile } from "@agent-trail/core";

export type TrailFile = { envelope?: TrailEnvelope; header: Header; entries: Entry[] };

export type SessionRef = {
  id: string;
  adapter: string;
  path?: string;
  cwd?: string;
  modifiedAt?: string;
  /**
   * Provenance of `id`. `"header"` means the adapter read the canonical id out
   * of the session header. `"filename-fallback"` means the header was
   * unreadable and the id was reconstructed from the filename — downstream
   * consumers should treat the session as suspect (truncated / corrupted).
   * Optional; adapters that can't distinguish leave it unset.
   */
  headerStatus?: "header" | "filename-fallback";
};

export type DetectOptions = {
  cwd?: string;
  since?: string;
  allCwds?: boolean;
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
export { codexAdapter } from "./codex/index.ts";
export type { BuildTrailEnvelopeOptions } from "./envelope.ts";
export { buildTrailEnvelope } from "./envelope.ts";
export { piAdapter } from "./pi/index.ts";

export async function validateAdapterTrail(
  trail: TrailFile,
  options: ValidateAdapterTrailOptions = {},
): Promise<Diagnostic[]> {
  const records: object[] = [];
  if (trail.envelope !== undefined) records.push(trail.envelope);
  records.push(trail.header, ...trail.entries);
  const lines = records.map((record) => JSON.stringify(record));
  return validateTrailString(`${lines.join("\n")}\n`, { profile: options.profile });
}
