import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionRef, TrailAdapter, TrailFile } from "@agent-trail/adapters";
import { runCli } from "./cli-runtime.ts";

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

function fakeAdapter(name: string, sessions: SessionRef[]): TrailAdapter {
  return {
    name,
    async detectSessions() {
      return sessions;
    },
    async parseSession(): Promise<TrailFile> {
      throw new Error("not needed");
    },
    async isAvailable() {
      return true;
    },
    async sourceVersion() {
      return null;
    },
    async sourceHealth() {
      return {
        adapter: name,
        path: null,
        present: true,
        readable: true,
        sessionCount: sessions.length,
        sourceVersion: null,
        warnings: [],
      };
    },
  };
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
      "--plain",
      "--source <source>",
      "--agent <name>",
      "--cwd <path>",
      "--since <iso>",
      "--until <iso>",
      "--limit <n>",
      "--search <query>",
      "--case-sensitive",
    ],
    example: "trail list --source registered --agent codex-cli",
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
    command: "status",
    usage: "Usage: trail status [options]",
    flags: ["--json"],
    example: "trail status --json",
  },
  {
    command: "adapters list",
    usage: "Usage: trail adapters list [options]",
    flags: ["--json"],
    example: "trail adapters list --json",
  },
  {
    command: "adapters status",
    usage: "Usage: trail adapters status [options]",
    flags: ["--json"],
    example: "trail adapters status --json",
  },
  {
    command: "doctor",
    usage: "Usage: trail doctor [options]",
    flags: ["--json", "--fix", "--yes"],
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
  expect(result.stdout).toContain("status");
  expect(result.stdout).toContain("adapters");
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

test("invalid config exits with a friendly diagnostic", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-invalid-config-"));
  try {
    const realProjectRoot = realpathSync(projectRoot);
    mkdirSync(join(projectRoot, ".agent-trail"), { recursive: true });
    const configPath = join(projectRoot, ".agent-trail", "config.json");
    const displayConfigPath = join(realProjectRoot, ".agent-trail", "config.json");
    writeFileSync(configPath, JSON.stringify({ tui: { previewByteCap: 0 } }));

    const result = await runCli(["discover", "--json"], {
      adapters: [],
      env: { HOME: projectRoot },
      projectRoot,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `config: ${displayConfigPath}: tui.previewByteCap must be a positive integer\n`,
    );
    expect(result.stderr).not.toContain("ConfigError");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("commands that do not consume config ignore invalid config files", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-version-invalid-config-"));
  try {
    mkdirSync(join(projectRoot, ".agent-trail"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".agent-trail", "config.json"),
      JSON.stringify({ tui: { previewByteCap: 0 } }),
    );

    const result = await runCli(["version"], {
      env: { HOME: projectRoot },
      projectRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("discover loads default source filter from config files through runCli", async () => {
  const home = mkdtempSync(join(tmpdir(), "trail-cli-config-home-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-config-project-"));
  try {
    mkdirSync(join(home, ".config", "trail"), { recursive: true });
    writeFileSync(
      join(home, ".config", "trail", "config.json"),
      JSON.stringify({ sources: { defaultFilter: "codex-cli" } }),
    );

    const result = await runCli(["discover", "--json", "--all"], {
      adapters: [
        fakeAdapter("codex", [
          {
            id: "sess-codex",
            adapter: "codex",
            cwd: "/work/config",
            modifiedAt: "2026-05-17T14:00:00.000Z",
          },
        ]),
        fakeAdapter("pi", [
          {
            id: "sess-pi",
            adapter: "pi",
            cwd: "/work/config",
            modifiedAt: "2026-05-18T14:00:00.000Z",
          },
        ]),
      ],
      env: { HOME: home },
      projectRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as Array<{
      adapter: string;
      cwd: string;
      id: string;
      modified_at: string;
      path: string | null;
    }>;
    expect(parsed).toEqual([
      {
        adapter: "codex",
        cwd: "/work/config",
        id: "sess-codex",
        modified_at: "2026-05-17T14:00:00.000Z",
        path: null,
      },
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
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
  expect(result.stdout).toContain("--source <source>");
  expect(result.stdout).toContain("--search <query>");
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
    const result = await runTrail([...helpCase.command.split(" "), "--help"]);

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
}, 15_000);
