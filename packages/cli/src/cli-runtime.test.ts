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
  expect(result.stdout).toContain("version");
  expect(result.stdout).toContain("validate");
  expect(result.stdout).toContain("discover");
  expect(result.stdout).toContain("export");
});

test("trail with no args prints help and exits 0", async () => {
  const result = await runTrail([]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail [options] [command]");
  expect(result.stdout).toContain("version");
});

test("trail version help exposes Commander-owned options", async () => {
  const result = await runTrail(["help", "version"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail version [options]");
  expect(result.stdout).toContain("--json");
});

test("trail validate help exposes Commander-owned options", async () => {
  const result = await runTrail(["validate", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail validate [options] <file>");
  expect(result.stdout).toContain("--json");
  expect(result.stdout).toContain("--profile <profile>");
});

test("trail discover help exposes Commander-owned options", async () => {
  const result = await runTrail(["discover", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail discover [options]");
  expect(result.stdout).toContain("--all");
  expect(result.stdout).toContain("--agent <name>");
  expect(result.stdout).toContain("--until <iso>");
});

test("trail list help exposes Commander-owned options", async () => {
  const result = await runTrail(["list", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail list [options]");
  expect(result.stdout).toContain("--agent <name>");
  expect(result.stdout).toContain("--kind <kind>");
  expect(result.stdout).toContain("--until <iso>");
});

test("trail load help exposes Commander-owned options", async () => {
  const result = await runTrail(["load", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail load [options] <url>");
  expect(result.stdout).toContain("--out <path>");
  expect(result.stdout).toContain("--force");
});

test("trail export help exposes Commander-owned options", async () => {
  const result = await runTrail(["export", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail export [options] <id>");
  expect(result.stdout).toContain("--out <path>");
  expect(result.stdout).toContain("--force");
});

test("trail share help exposes Commander-owned options", async () => {
  const result = await runTrail(["share", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail share [options] <path>");
  expect(result.stdout).toContain("--dry-run");
  expect(result.stdout).toContain("--skip-redaction");
});
