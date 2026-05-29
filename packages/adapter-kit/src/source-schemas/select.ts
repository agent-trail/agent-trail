import ccMeta from "@agent-trail/source-schemas/claude-code/meta" with { type: "json" };
import codexMeta from "@agent-trail/source-schemas/codex/meta" with { type: "json" };
import piMeta from "@agent-trail/source-schemas/pi/meta" with { type: "json" };
import semver from "semver";

type VersionRange = { schemaVersion: string; range: string };
type SourceMeta = { version_ranges: VersionRange[]; fallback?: string };

const metas: Record<string, SourceMeta> = {
  codex: codexMeta as SourceMeta,
  pi: piMeta as SourceMeta,
  "claude-code": ccMeta as SourceMeta,
};

/**
 * Resolve a source-format schema version key from the upstream version reported
 * by a recording (e.g. codex `cli_version`, pi numeric `version`). Returns the
 * first range that matches, else the agent's declared `fallback`. A missing
 * version or unknown agent yields `undefined` — the caller decides whether to
 * quarantine wholesale.
 */
export function selectSchemaVersion(
  agent: string,
  sourceVersion: string | number | undefined,
): string | undefined {
  const meta = metas[agent];
  if (meta === undefined) {
    return undefined;
  }
  if (sourceVersion === undefined) {
    return undefined;
  }
  const raw = String(sourceVersion);
  const normalized = semver.valid(raw) ?? semver.coerce(raw)?.version;
  if (normalized !== undefined) {
    for (const range of meta.version_ranges) {
      if (semver.satisfies(normalized, range.range, { includePrerelease: true })) {
        return range.schemaVersion;
      }
    }
  }
  return meta.fallback;
}
