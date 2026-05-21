import { join } from "node:path";

export function piConfigDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.PI_CONFIG_DIR !== undefined && env.PI_CONFIG_DIR.length > 0) {
    return env.PI_CONFIG_DIR;
  }
  const home = env.HOME ?? env.USERPROFILE;
  return home === undefined ? undefined : join(home, ".pi");
}

// Pi mangling differs from Claude Code: the cwd is wrapped with `--...--`.
// Empirically verified against ~/.pi/agent/sessions: `/Users/somu/Code` → `--Users-somu-Code--`,
// root `/` → `----`. The leading `/` is dropped before slash-to-dash replacement.
export function mangleCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/^\//, "");
  const inner = normalized.replace(/[/:]/g, "-");
  return `--${inner}--`;
}

export function piProjectDir({ configDir, cwd }: { configDir: string; cwd: string }): string {
  return join(configDir, "agent", "sessions", mangleCwd(cwd));
}
