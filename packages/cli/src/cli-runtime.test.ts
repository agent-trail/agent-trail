import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../..", import.meta.url);

async function runTrail(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "packages/cli/src/bin.ts", ...args], {
    cwd: fileURLToPath(ROOT),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

test("trail help exposes the Commander command surface", async () => {
  const result = await runTrail(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail [options] [command]");
  expect(result.stdout).toContain("validate");
  expect(result.stdout).toContain("discover");
  expect(result.stdout).toContain("export");
});
