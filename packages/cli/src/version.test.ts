import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import pkg from "../package.json" with { type: "json" };

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

async function runTrailDirect(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["./packages/cli/src/bin.ts", ...args], {
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

test("bin.ts remains directly executable", async () => {
  const result = await runTrailDirect(["--version"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(`${pkg.version}\n`);
  expect(result.stderr).toBe("");
});

test("trail help dispatch prints usage", async () => {
  const result = await runTrail(["help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: trail [options] [command]");
  expect(result.stdout).toContain("validate");
  expect(result.stderr).toBe("");
});

test("trail validate dispatch accepts a valid fixture", async () => {
  const fixture = fileURLToPath(
    new URL("tests/fixtures/validation/valid/minimal-linear.trail.jsonl", ROOT),
  );
  const result = await runTrail(["validate", fixture]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("trail dispatch rejects inherited object keys as unknown commands", async () => {
  const result = await runTrail(["toString"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Usage:");
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
