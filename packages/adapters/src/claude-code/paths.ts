import { join } from "node:path";

export function claudeCodeConfigDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CLAUDE_CONFIG_DIR !== undefined && env.CLAUDE_CONFIG_DIR.length > 0) {
    return env.CLAUDE_CONFIG_DIR;
  }
  const home = env.HOME ?? env.USERPROFILE;
  return home === undefined ? undefined : join(home, ".claude");
}

export function mangleCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/[/:]/g, "-");
}

export function claudeCodeProjectDir({
  configDir,
  cwd,
}: {
  configDir: string;
  cwd: string;
}): string {
  return join(configDir, "projects", mangleCwd(cwd));
}
