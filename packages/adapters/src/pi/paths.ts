import { join } from "node:path";

export function piConfigDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.PI_CONFIG_DIR !== undefined && env.PI_CONFIG_DIR.length > 0) {
    return env.PI_CONFIG_DIR;
  }
  const home = env.HOME ?? env.USERPROFILE;
  return home === undefined ? undefined : join(home, ".pi");
}

export function mangleCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/[/:]/g, "-");
}

export function piProjectDir({ configDir, cwd }: { configDir: string; cwd: string }): string {
  return join(configDir, "agent", "sessions", mangleCwd(cwd));
}
