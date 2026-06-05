import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, resolveConfig } from "./config.ts";

test("resolves config with built-in, user, committed project, then local project precedence", async () => {
  const home = mkdtempSync(join(tmpdir(), "trail-config-home-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-config-project-"));
  try {
    mkdirSync(join(home, ".config", "trail"), { recursive: true });
    mkdirSync(join(projectRoot, ".agent-trail"), { recursive: true });
    writeFileSync(
      join(home, ".config", "trail", "config.json"),
      JSON.stringify({
        sources: { defaultFilter: "codex" },
        tui: { previewByteCap: 10_000 },
      }),
    );
    writeFileSync(
      join(projectRoot, ".agent-trail", "config.json"),
      JSON.stringify({
        sources: { defaultFilter: "pi" },
        tui: { previewEventCap: 250 },
      }),
    );
    writeFileSync(
      join(projectRoot, ".agent-trail", "config.local.json"),
      JSON.stringify({
        tui: { previewByteCap: 2048 },
      }),
    );

    const resolved = await resolveConfig({ env: { HOME: home }, projectRoot });

    expect(resolved.config).toEqual({
      sources: { defaultFilter: "pi" },
      tui: { previewByteCap: 2048, previewEventCap: 250 },
      keymap: {},
    });
    expect(resolved.sources.map((source) => [source.layer, source.status])).toEqual([
      ["built_in", "default"],
      ["user_global", "loaded"],
      ["project_committed", "loaded"],
      ["project_local", "loaded"],
    ]);
    expect(resolved.sources[1]?.path).toBe(join(home, ".config", "trail", "config.json"));
    expect(resolved.sources[2]?.path).toBe(join(projectRoot, ".agent-trail", "config.json"));
    expect(resolved.sources[3]?.path).toBe(join(projectRoot, ".agent-trail", "config.local.json"));
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("invalid config reports friendly diagnostics with file path context", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-config-invalid-"));
  try {
    mkdirSync(join(projectRoot, ".agent-trail"), { recursive: true });
    const configPath = join(projectRoot, ".agent-trail", "config.json");
    writeFileSync(configPath, JSON.stringify({ sources: { unknown: true } }));

    await expect(resolveConfig({ env: { HOME: projectRoot }, projectRoot })).rejects.toThrow(
      ConfigError,
    );
    await expect(resolveConfig({ env: { HOME: projectRoot }, projectRoot })).rejects.toThrow(
      `config: ${configPath}: unknown key: sources.unknown`,
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("invalid JSON reports friendly diagnostics without a stack trace", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-config-json-"));
  try {
    mkdirSync(join(projectRoot, ".agent-trail"), { recursive: true });
    const configPath = join(projectRoot, ".agent-trail", "config.local.json");
    writeFileSync(configPath, "{not json");

    await expect(resolveConfig({ env: { HOME: projectRoot }, projectRoot })).rejects.toThrow(
      `config: ${configPath}: invalid JSON`,
    );
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
