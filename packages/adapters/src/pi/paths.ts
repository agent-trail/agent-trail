import { join } from "node:path";

// Pi's config root env var (verified against pi-mono `coding-agent/src/config.ts`).
// Pi calls this `ENV_AGENT_DIR` (`<APP_NAME>_CODING_AGENT_DIR`). It points to the
// agent root — the directory that contains `sessions/`. Default: `~/.pi/agent`.
export function piAgentDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.PI_CODING_AGENT_DIR !== undefined && env.PI_CODING_AGENT_DIR.length > 0) {
    return env.PI_CODING_AGENT_DIR;
  }
  const home = env.HOME ?? env.USERPROFILE;
  return home === undefined ? undefined : join(home, ".pi", "agent");
}

// Pi also defines `ENV_SESSION_DIR` (`<APP_NAME>_CODING_AGENT_SESSION_DIR`) for
// relocating session storage independently of the agent root. Treat it as a hard
// override when set; otherwise sessions live under `<agentDir>/sessions`.
export function piSessionsDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.PI_CODING_AGENT_SESSION_DIR !== undefined && env.PI_CODING_AGENT_SESSION_DIR.length > 0) {
    return env.PI_CODING_AGENT_SESSION_DIR;
  }
  const agent = piAgentDir(env);
  return agent === undefined ? undefined : join(agent, "sessions");
}

// Pi mangling: drop leading `/`, replace path separators with `-`, wrap with
// `--...--`. Empirically verified against `~/.pi/agent/sessions`.
export function mangleCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/^\//, "");
  const inner = normalized.replace(/[/:]/g, "-");
  return `--${inner}--`;
}

export function piProjectDir({ sessionsDir, cwd }: { sessionsDir: string; cwd: string }): string {
  return join(sessionsDir, mangleCwd(cwd));
}

// Pi stores per-cwd dirs directly under `sessionsDir`; no extra subdirectory.
export function piProjectsRoot(sessionsDir: string): string {
  return sessionsDir;
}
