import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function preflightOutputPath(
  command: string,
  outPath: string,
  force: boolean,
): Promise<CommandResult | null> {
  let info: Awaited<ReturnType<typeof stat>> | null;
  try {
    info = await stat(outPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (info.isDirectory()) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${command}: --out path is a directory: ${outPath}\n`,
    };
  }
  if (!force) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${command}: --out path exists: ${outPath}\nHint: pass --force to overwrite.\n`,
    };
  }
  return null;
}

export async function writeOutputFile(
  command: string,
  outPath: string,
  bytes: string | Uint8Array,
  force: boolean,
): Promise<CommandResult | null> {
  const preflight = await preflightOutputPath(command, outPath, force);
  if (preflight !== null) return preflight;
  await mkdir(dirname(outPath), { recursive: true });
  try {
    await writeFile(outPath, bytes, { flag: force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${command}: --out path exists: ${outPath}\nHint: pass --force to overwrite.\n`,
      };
    }
    throw error;
  }
  return null;
}
