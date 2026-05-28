import { join } from "node:path";

// Codex CLI honors `CODEX_HOME` as the home directory override (defaults to
// `~/.codex`). Sessions live under `<codexHome>/sessions/YYYY/MM/DD/`. Verified
// against Codex CLI 0.98.0 (originator `codex_sdk_ts`); see
// `docs/parser-source-matrix.md` Codex row for layout notes.
export function codexHomeDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // Trim before length check so a whitespace-only `CODEX_HOME=" "` (almost
  // always a shell-quoting mistake) falls through to the default instead of
  // silently producing an unreachable `"   /sessions/"` path.
  const override = env.CODEX_HOME?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  const home = env.HOME ?? env.USERPROFILE;
  return home === undefined ? undefined : join(home, ".codex");
}

export function codexSessionsDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = codexHomeDir(env);
  return home === undefined ? undefined : join(home, "sessions");
}
