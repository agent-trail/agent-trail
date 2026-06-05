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

type HelpCase = {
  command: string;
  usage: string;
  flags: string[];
  example: string;
};

const HELP_CASES: HelpCase[] = [
  {
    command: "version",
    usage: "Usage: trail version [options]",
    flags: ["--json"],
    example: "trail version --json",
  },
  {
    command: "validate",
    usage: "Usage: trail validate [options] <file>",
    flags: ["--json", "--profile <profile>"],
    example: "trail validate session.trail.jsonl --profile reader",
  },
  {
    command: "list",
    usage: "Usage: trail list [options]",
    flags: [
      "--json",
      "--agent <name>",
      "--cwd <path>",
      "--since <iso>",
      "--until <iso>",
      "--kind <kind>",
    ],
    example: "trail list --agent codex-cli --kind session",
  },
  {
    command: "register",
    usage: "Usage: trail register [options] <file|adapter:id>",
    flags: ["--json"],
    example: "trail register claude-code:abc123",
  },
  {
    command: "discover",
    usage: "Usage: trail discover [options]",
    flags: [
      "--json",
      "--all",
      "--agent <name>",
      "--cwd <path>",
      "--since <iso>",
      "--until <iso>",
      "--limit <n>",
      "--search <query>",
      "--case-sensitive",
    ],
    example: "trail discover --agent codex-cli --json",
  },
  {
    command: "doctor",
    usage: "Usage: trail doctor [options]",
    flags: ["--json"],
    example: "trail doctor --json",
  },
  {
    command: "share",
    usage: "Usage: trail share [options] <path>",
    flags: ["--dry-run", "-y, --yes", "--skip-redaction", "--keep-remote-url"],
    example: "trail share session.trail.jsonl --dry-run",
  },
  {
    command: "load",
    usage: "Usage: trail load [options] <url>",
    flags: ["--out <path>", "--force"],
    example:
      "trail load https://agent-trail.dev/view/gist/abcdef1234567890abcd --out loaded.trail.jsonl",
  },
  {
    command: "export",
    usage: "Usage: trail export [options] <id>",
    flags: ["--out <path>", "--force"],
    example: "trail export abcdef12 --out exported.trail.jsonl",
  },
];

test("trail help exposes the Commander command surface", async () => {
  const result = await runTrail(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail [options] [command]");
  expect(result.stdout).toContain("version");
  expect(result.stdout).toContain("validate");
  expect(result.stdout).toContain("register");
  expect(result.stdout).toContain("discover");
  expect(result.stdout).toContain("export");
  expect(result.stdout).toContain(
    "Run `trail <command> --help` for command-specific flags and examples.",
  );
});

test("trail with no args prints help and exits 0", async () => {
  const result = await runTrail([]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toContain("Usage: trail [options] [command]");
  expect(result.stdout).toContain("version");
  expect(result.stdout).toContain("register");
  expect(result.stdout).toContain(
    "Run `trail <command> --help` for command-specific flags and examples.",
  );
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

test("each command help lists usage, options, and examples", async () => {
  for (const helpCase of HELP_CASES) {
    const result = await runTrail([helpCase.command, "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(helpCase.usage);
    expect(result.stdout).toContain("Options:");
    for (const flag of helpCase.flags) {
      expect(result.stdout).toContain(flag);
    }
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain(helpCase.example);
  }
});
