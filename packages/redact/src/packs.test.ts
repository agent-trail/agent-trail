import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRedactionConfig } from "./packs.ts";

let home: string;
let projectRoot: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "trail-redact-home-"));
  projectRoot = mkdtempSync(join(tmpdir(), "trail-redact-project-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

test("resolveRedactionConfig merges project settings before user-global settings", async () => {
  mkdirSync(join(projectRoot, ".trail"), { recursive: true });
  mkdirSync(join(home, ".config", "trail"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "settings.json"),
    JSON.stringify({
      redaction: {
        allowedSecrets: ["project-safe"],
        pii: { ssn: false, emailAllowlist: ["*@project.example"] },
      },
    }),
  );
  writeFileSync(
    join(home, ".config", "trail", "settings.json"),
    JSON.stringify({
      redaction: {
        allowedSecrets: ["global-safe"],
        pii: { ssn: true, name: false, emailAllowlist: ["*@global.example"] },
      },
    }),
  );

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.allowedSecrets).toEqual(["project-safe", "global-safe"]);
  expect(config.pii).toEqual({
    ssn: true,
    name: false,
    emailAllowlist: ["*@project.example", "*@global.example"],
  });
});

test("resolveRedactionConfig accepts credit_card settings key", async () => {
  mkdirSync(join(projectRoot, ".trail"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "settings.json"),
    JSON.stringify({
      redaction: {
        pii: { credit_card: false },
      },
    }),
  );

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.pii).toEqual({ creditCard: false });
});

test("resolveRedactionConfig fails on malformed settings JSON", async () => {
  mkdirSync(join(projectRoot, ".trail"), { recursive: true });
  writeFileSync(join(projectRoot, ".trail", "settings.json"), "{", "utf8");

  await expect(resolveRedactionConfig({ env: { HOME: home }, projectRoot })).rejects.toThrow(
    "redaction settings invalid JSON",
  );
});

test("resolveRedactionConfig ignores absent settings below non-directories", async () => {
  writeFileSync(join(home, ".config"), "not a directory", "utf8");

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config).toMatchObject({ allowedSecrets: [], packs: [], warnings: [] });
});

test("resolveRedactionConfig rejects unsafe custom label regexes in settings", async () => {
  mkdirSync(join(projectRoot, ".trail"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "settings.json"),
    JSON.stringify({
      redaction: {
        pii: { customLabels: { employee_id: "^(EMP-\\d+)+$" } },
      },
    }),
  );

  await expect(resolveRedactionConfig({ env: { HOME: home }, projectRoot })).rejects.toThrow(
    "regex is unsafe",
  );
});

test("resolveRedactionConfig rejects partial email allowlist shorthands", async () => {
  mkdirSync(join(projectRoot, ".trail"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "settings.json"),
    JSON.stringify({
      redaction: {
        pii: { emailAllowlist: ["@gmail.com", "actions@"] },
      },
    }),
  );

  await expect(resolveRedactionConfig({ env: { HOME: home }, projectRoot })).rejects.toThrow(
    "pii.emailAllowlist contains invalid pattern",
  );
});

test("resolveRedactionConfig warns and skips packs with unsafe regexes", async () => {
  mkdirSync(join(projectRoot, ".trail", "redactors"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "acme.yaml"),
    [
      "name: acme",
      "version: 1",
      "rules:",
      "  - id: acme_token",
      "    description: unsafe",
      "    regex: '^(ACME-[A-Z0-9]+)+$'",
      "    placeholder: '[ACME_TOKEN]'",
    ].join("\n"),
  );

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.packs).toEqual([]);
  expect(config.warnings.join("\n")).toContain("regex is unsafe");
});

test("resolveRedactionConfig warns and skips packs with quantified alternation regexes", async () => {
  mkdirSync(join(projectRoot, ".trail", "redactors"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "acme.yaml"),
    [
      "name: acme",
      "version: 1",
      "rules:",
      "  - id: acme_token",
      "    description: unsafe alternation",
      "    regex: '^(a|aa)+$'",
      "    placeholder: '[ACME_TOKEN]'",
    ].join("\n"),
  );
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "nested.yaml"),
    [
      "name: nested",
      "version: 1",
      "rules:",
      "  - id: nested_token",
      "    description: nested unsafe alternation",
      "    regex: '^((a|aa))+$'",
      "    placeholder: '[NESTED_TOKEN]'",
    ].join("\n"),
  );
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "noncapturing.yaml"),
    [
      "name: noncapturing",
      "version: 1",
      "rules:",
      "  - id: noncapturing_token",
      "    description: noncapturing unsafe alternation",
      "    regex: '^((?:a|aa))+$'",
      "    placeholder: '[NONCAPTURING_TOKEN]'",
    ].join("\n"),
  );
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "bounded.yaml"),
    [
      "name: bounded",
      "version: 1",
      "rules:",
      "  - id: bounded_token",
      "    description: bounded unsafe alternation",
      "    regex: '^(a|aa){1,250}$'",
      "    placeholder: '[BOUNDED_TOKEN]'",
    ].join("\n"),
  );

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.packs).toEqual([]);
  expect(config.warnings.join("\n").match(/quantified alternation/g)).toHaveLength(4);
});

test("resolveRedactionConfig warns and skips packs with duplicate global rule ids", async () => {
  mkdirSync(join(projectRoot, ".trail", "redactors"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "acme.yaml"),
    [
      "name: acme",
      "version: 1",
      "rules:",
      "  - id: openai_api_key",
      "    description: duplicate",
      "    regex: 'ACME-[A-Z0-9]{8}'",
      "    placeholder: '[ACME_TOKEN]'",
    ].join("\n"),
  );

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.packs).toEqual([]);
  expect(config.warnings.join("\n")).toContain("duplicate global rule id");
});

test("resolveRedactionConfig warns and skips packs using reserved allowed-secret placeholders", async () => {
  mkdirSync(join(projectRoot, ".trail", "redactors"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "acme.yaml"),
    [
      "name: acme",
      "version: 1",
      "rules:",
      "  - id: acme_token",
      "    description: reserved placeholder",
      "    regex: 'ACME-[A-Z0-9]{8}'",
      "    placeholder: '__AGENT_TRAIL_ALLOWED_SECRET_fake_0__'",
    ].join("\n"),
  );

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.packs).toEqual([]);
  expect(config.warnings.join("\n")).toContain("reserved allowed-secret token namespace");
});

test("resolveRedactionConfig keeps the first valid pack when names duplicate across roots", async () => {
  mkdirSync(join(projectRoot, ".trail", "redactors"), { recursive: true });
  mkdirSync(join(home, ".config", "trail", "redactors"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "acme.yaml"),
    [
      "name: acme",
      "version: 1",
      "allowlist:",
      "  - project-safe",
      "rules:",
      "  - id: acme_project_token",
      "    description: project pack",
      "    regex: 'ACME-PROJ-[A-Z0-9]{4}'",
      "    placeholder: '[ACME_PROJECT_TOKEN]'",
    ].join("\n"),
  );
  writeFileSync(
    join(home, ".config", "trail", "redactors", "acme.yaml"),
    [
      "name: acme",
      "version: 1",
      "allowlist:",
      "  - global-safe",
      "rules:",
      "  - id: acme_global_token",
      "    description: global pack",
      "    regex: 'ACME-GLOB-[A-Z0-9]{4}'",
      "    placeholder: '[ACME_GLOBAL_TOKEN]'",
    ].join("\n"),
  );

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.packs).toHaveLength(1);
  expect(config.packs[0]?.source).toBe("project");
  expect(config.packs[0]?.patterns.map((pattern) => pattern.id)).toEqual(["acme_project_token"]);
  expect(config.allowedSecrets).toEqual(["project-safe"]);
  expect(config.warnings.join("\n")).toContain("duplicate name skipped");
});

test("resolveRedactionConfig warns and skips invalid pack samples and duplicate pack rule ids", async () => {
  mkdirSync(join(projectRoot, ".trail", "redactors"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "bad-sample.yaml"),
    [
      "name: bad-sample",
      "version: 1",
      "rules:",
      "  - id: acme_token",
      "    description: bad sample",
      "    regex: 'ACME-[A-Z0-9]{8}'",
      "    placeholder: '[ACME_TOKEN]'",
      "    samples:",
      "      - input: 'ACME-ABCDEFGH'",
      "        redacted: false",
    ].join("\n"),
  );
  writeFileSync(
    join(projectRoot, ".trail", "redactors", "dupe.yaml"),
    [
      "name: dupe",
      "version: 1",
      "rules:",
      "  - id: acme_token",
      "    description: one",
      "    regex: 'ACME-[A-Z0-9]{8}'",
      "    placeholder: '[ACME_TOKEN]'",
      "  - id: acme_token",
      "    description: two",
      "    regex: 'ACME-[A-Z0-9]{8}'",
      "    placeholder: '[ACME_TOKEN]'",
    ].join("\n"),
  );

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.packs).toEqual([]);
  expect(config.warnings.join("\n")).toContain("sample failed");
  expect(config.warnings.join("\n")).toContain("duplicate rule id");
});

test("resolveRedactionConfig skips symlinked, oversized, and over-limit pack files", async () => {
  const root = join(projectRoot, ".trail", "redactors");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "target.yaml"), "name: target\nversion: 1\nrules: []\n");
  symlinkSync(join(root, "target.yaml"), join(root, "linked.yaml"));
  writeFileSync(join(root, "oversize.yaml"), "x".repeat(1024 * 1024 + 1));
  for (let i = 0; i < 257; i += 1) {
    const name = `z${String(i).padStart(3, "0")}`;
    writeFileSync(join(root, `${name}.yaml`), `name: ${name}\nversion: 1\nrules: []\n`);
  }

  const config = await resolveRedactionConfig({ env: { HOME: home }, projectRoot });

  expect(config.warnings.join("\n")).toContain("redaction pack skipped symlink");
  expect(config.warnings.join("\n")).toContain("redaction pack too large");
  expect(config.warnings.join("\n")).toContain("redaction pack limit exceeded");
});
