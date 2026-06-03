import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

async function runTrail(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "packages/cli/src/bin.ts", ...args], {
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
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

test("trail --version prints the CLI package version", async () => {
  const result = await runTrail(["--version"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(`${pkg.version}\n`);
  expect(result.stderr).toBe("");
});

test("trail -V prints the CLI package version", async () => {
  const result = await runTrail(["-V"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(`${pkg.version}\n`);
  expect(result.stderr).toBe("");
});

test("trail version prints the CLI package version", async () => {
  const result = await runTrail(["version"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(`${pkg.version}\n`);
  expect(result.stderr).toBe("");
});

test("trail --version --json prints the CLI package version as JSON", async () => {
  const result = await runTrail(["--version", "--json"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ version: pkg.version });
  expect(result.stderr).toBe("");
});

test("trail -V --json prints the CLI package version as JSON", async () => {
  const result = await runTrail(["-V", "--json"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ version: pkg.version });
  expect(result.stderr).toBe("");
});

test("trail version --json prints the CLI package version as JSON", async () => {
  const result = await runTrail(["version", "--json"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ version: pkg.version });
  expect(result.stderr).toBe("");
});

test("version forms reject unknown extra arguments", async () => {
  for (const args of [
    ["--version", "--nope"],
    ["-V", "--nope"],
    ["version", "--nope"],
  ]) {
    const result = await runTrail(args);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--nope");
    expect(result.stderr).toContain("Usage: trail version");
  }
});
