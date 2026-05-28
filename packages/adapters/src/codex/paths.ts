import { join } from "node:path";

// Codex CLI honors `CODEX_HOME` as the home directory override (defaults to
// `~/.codex`). Sessions live under `<codexHome>/sessions/YYYY/MM/DD/`. Verified
// against Codex CLI 0.98.0 (originator `codex_sdk_ts`); see
// `docs/parser-source-matrix.md` Codex row for layout notes.
export function codexHomeDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CODEX_HOME !== undefined && env.CODEX_HOME.length > 0) {
    return env.CODEX_HOME;
  }
  const home = env.HOME ?? env.USERPROFILE;
  return home === undefined ? undefined : join(home, ".codex");
}

export function codexSessionsDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = codexHomeDir(env);
  return home === undefined ? undefined : join(home, "sessions");
}
