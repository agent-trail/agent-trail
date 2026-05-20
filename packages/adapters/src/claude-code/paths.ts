import { join } from "node:path";

export function mangleCwd(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

export function claudeCodeProjectDir({ home, cwd }: { home: string; cwd: string }): string {
  return join(home, ".claude", "projects", mangleCwd(cwd));
}
