import { type Diagnostic, type ValidationProfile, validateTrailString } from "@agent-trail/core";
import type { Entry, Header, TrailEnvelope } from "@agent-trail/types";

export type { Diagnostic, ValidationProfile } from "@agent-trail/core";

export type TrailSessionGroup = { header: Header; entries: Entry[] };

export type TrailFile = { envelope?: TrailEnvelope; groups: TrailSessionGroup[] };

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

export type AdapterSourceHealth = {
  adapter: string;
  path: string | null;
  present: boolean;
  readable: boolean;
  sessionCount: number;
  sourceVersion: string | null;
  warnings: string[];
};

export interface TrailAdapter {
  readonly name: string;
  detectSessions(opts?: DetectOptions): Promise<SessionRef[]>;
  parseSession(ref: SessionRef): Promise<TrailFile>;
  isAvailable(): Promise<boolean>;
  sourceVersion(): Promise<string | null>;
  sourceHealth(): Promise<AdapterSourceHealth>;
}

export type ValidateAdapterTrailOptions = { profile?: ValidationProfile };

export { claudeCodeAdapter } from "./claude-code/index.ts";
export { codexAdapter } from "./codex/index.ts";
export type { BuildTrailEnvelopeOptions } from "./envelope.ts";
export { buildTrailEnvelope } from "./envelope.ts";
export { opencodeAdapter } from "./opencode/index.ts";
export { piAdapter } from "./pi/index.ts";
export { DISCOVERY_CONCURRENCY_LIMIT, mapConcurrent } from "./shared/concurrency.ts";
export { ADAPTERS, adapterByName, defaultTrailAdapters } from "./shared/registry.ts";

export function trailRecords(trail: TrailFile): object[] {
  const records: object[] = [];
  if (trail.envelope !== undefined) records.push(trail.envelope);
  for (const group of trail.groups) {
    records.push(group.header, ...group.entries);
  }
  return records;
}

export async function validateAdapterTrail(
  trail: TrailFile,
  options: ValidateAdapterTrailOptions = {},
): Promise<Diagnostic[]> {
  const lines = trailRecords(trail).map((record) => JSON.stringify(record));
  return validateTrailString(`${lines.join("\n")}\n`, { profile: options.profile });
}
