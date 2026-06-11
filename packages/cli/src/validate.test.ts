import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../../../tests/fixtures/validation/manifest.json" with { type: "json" };
import { runCli } from "./cli-runtime.ts";
import { runValidate } from "./validate.ts";

const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const fixturePath = (rel: string) => fileURLToPath(new URL(rel, FIXTURES));

type DiagnosticAssertion = {
  line: number;
  path?: string;
  severity?: "error" | "warning";
  code?: string;
};

type ManifestFixture = {
  path: string;
  strict: {
    valid: boolean;
    diagnostics: DiagnosticAssertion[];
  };
  tolerant: {
    clean: boolean;
    diagnostics: DiagnosticAssertion[];
  };
};

const VALID_HEADER =
  '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
const VALID_USER_MESSAGE =
  '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}';

async function writeFixture(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trail-cli-"));
  const path = join(dir, "trail.jsonl");
  await Bun.write(path, content);
  return path;
}

const PORTABLE_CODES = new Set(
  (manifest as { fixtures: ManifestFixture[] }).fixtures.flatMap((fixture) =>
    [...fixture.strict.diagnostics, ...fixture.tolerant.diagnostics]
      .map((diagnostic) => diagnostic.code)
      .filter((code): code is string => code !== undefined),
  ),
);

function simplifyDiagnostics(diagnostics: DiagnosticAssertion[]): DiagnosticAssertion[] {
  const assertions = diagnostics.map((diagnostic) =>
    diagnostic.code !== undefined && PORTABLE_CODES.has(diagnostic.code)
      ? {
          line: diagnostic.line,
          path: diagnostic.path,
          severity: diagnostic.severity,
          code: diagnostic.code,
        }
      : { line: diagnostic.line },
  );
  const seen = new Set<string>();
  return assertions
    .filter((assertion) => {
      const key = JSON.stringify(assertion);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareDiagnosticAssertions);
}

function compareDiagnosticAssertions(a: DiagnosticAssertion, b: DiagnosticAssertion): number {
  return (
    a.line - b.line ||
    (a.path ?? "").localeCompare(b.path ?? "") ||
    (a.code ?? "").localeCompare(b.code ?? "")
  );
}

test("valid trail exits 0 with empty stdout", async () => {
  const path = await writeFixture(`${VALID_HEADER}\n${VALID_USER_MESSAGE}\n`);

  const result = await runValidate({ file: path });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
});

test("multiple positional file arguments exit 1 with usage on stderr", async () => {
  const a = await writeFixture(`${VALID_HEADER}\n`);
  const b = await writeFixture(`${VALID_HEADER}\n`);

  const result = await runCli(["validate", a, b]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("too many arguments");
  expect(result.stderr).toContain("Usage: trail validate");
});

test("missing file argument exits 1 with usage on stderr", async () => {
  const result = await runCli(["validate", "--json"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("missing required argument");
  expect(result.stderr).toContain("Usage: trail validate");
});

test("unknown flag exits 1 with usage on stderr", async () => {
  const result = await runCli(["validate", "--nope"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("--nope");
  expect(result.stderr).toContain("Usage: trail validate");
});

test("invalid --profile value exits 1 with stderr listing valid options", async () => {
  const path = await writeFixture(`${VALID_HEADER}\n`);

  const result = await runValidate({ file: path, profile: "loose" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("strict");
  expect(result.stderr).toContain("reader-tolerant");
});

test("missing file exits 1 with a stderr message", async () => {
  const result = await runValidate({ file: "/definitely/not/a/real/path.jsonl" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("file not found");
  expect(result.stderr).toContain("/definitely/not/a/real/path.jsonl");
});

test("--profile reader-tolerant downgrades unknown payload fields to warnings (exit 0)", async () => {
  const tolerantMessage =
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi","extra":"x"}}';
  const path = await writeFixture(`${VALID_HEADER}\n${tolerantMessage}\n`);

  const result = await runValidate({ file: path, profile: "reader-tolerant" });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("warning reader_tolerant_unknown_payload_field");
});

test("--json prints a JSON array of diagnostics", async () => {
  const badHeader =
    '{"type":"session","schema_version":"0.2.0","id":"01HSESS0000000000000000001","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
  const path = await writeFixture(`${badHeader}\n`);

  const result = await runValidate({ file: path, json: true });

  expect(result.exitCode).toBe(1);
  const parsed = JSON.parse(result.stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed[0]).toMatchObject({
    line: 1,
    path: "/schema_version",
    severity: "error",
    code: "const",
  });
});

test("--json on valid file emits an empty JSON array with exit 0", async () => {
  const path = await writeFixture(`${VALID_HEADER}\n${VALID_USER_MESSAGE}\n`);

  const result = await runValidate({ file: path, json: true });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([]);
});

test("invalid trail exits 1 with line-aware text diagnostic", async () => {
  const badHeader =
    '{"type":"session","schema_version":"0.2.0","id":"01HSESS0000000000000000001","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
  const path = await writeFixture(`${badHeader}\n`);

  const result = await runValidate({ file: path });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("error const line 1 /schema_version:");
});

test("same unknown payload field fails strict but passes reader-tolerant", async () => {
  const messageWithExtra =
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi","extra":"x"}}';
  const path = await writeFixture(`${VALID_HEADER}\n${messageWithExtra}\n`);

  const strict = await runValidate({ file: path, profile: "strict" });
  expect(strict.exitCode).toBe(1);
  expect(strict.stdout).toContain("error additionalProperties line 2 /payload/extra:");

  const tolerant = await runValidate({ file: path, profile: "reader-tolerant" });
  expect(tolerant.exitCode).toBe(0);
  expect(tolerant.stdout).toContain(
    "warning reader_tolerant_unknown_payload_field line 2 /payload/extra:",
  );
});

test("patch-compatible schema_version fails strict but warns under reader-tolerant", async () => {
  const patchHeader =
    '{"type":"session","schema_version":"0.1.1","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
  const path = await writeFixture(`${patchHeader}\n`);

  const strict = await runValidate({ file: path, profile: "strict", json: true });
  expect(strict.exitCode).toBe(1);
  const strictDiagnostics = JSON.parse(strict.stdout);
  expect(strictDiagnostics).toContainEqual(
    expect.objectContaining({
      line: 1,
      path: "/schema_version",
      severity: "error",
      code: "const",
    }),
  );

  const tolerant = await runValidate({ file: path, profile: "reader-tolerant", json: true });
  expect(tolerant.exitCode).toBe(0);
  expect(JSON.parse(tolerant.stdout)).toEqual([
    {
      line: 1,
      path: "/schema_version",
      severity: "warning",
      code: "reader_tolerant_schema_version",
      message: 'schema_version "0.1.1" accepted by reader-tolerant patch compatibility',
    },
  ]);
});

for (const fixture of (manifest as { fixtures: ManifestFixture[] }).fixtures) {
  test(`committed fixture ${fixture.path} matches strict trail validate expectation`, async () => {
    const result = await runValidate({
      file: fixturePath(fixture.path),
      json: true,
    });
    expect(result.exitCode).toBe(fixture.strict.valid ? 0 : 1);
    expect(simplifyDiagnostics(JSON.parse(result.stdout))).toEqual(fixture.strict.diagnostics);
  });

  test(`committed fixture ${fixture.path} matches reader-tolerant trail validate expectation`, async () => {
    const result = await runValidate({
      file: fixturePath(fixture.path),
      json: true,
      profile: "reader-tolerant",
    });
    const rawDiagnostics = JSON.parse(result.stdout);
    const diagnostics = simplifyDiagnostics(rawDiagnostics);
    expect(diagnostics).toEqual(fixture.tolerant.diagnostics);
    expect(result.exitCode).toBe(
      rawDiagnostics.some((diagnostic: { severity?: string }) => diagnostic.severity === "error")
        ? 1
        : 0,
    );
  });
}

test("--json under reader-tolerant serializes warnings with full diagnostic shape", async () => {
  const messageWithExtra =
    '{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi","extra":"x"}}';
  const path = await writeFixture(`${VALID_HEADER}\n${messageWithExtra}\n`);

  const result = await runValidate({ file: path, profile: "reader-tolerant", json: true });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    {
      line: 2,
      path: "/payload/extra",
      severity: "warning",
      code: "reader_tolerant_unknown_payload_field",
      message: 'Unknown payload field "extra" preserved for reader-tolerant parsing',
    },
  ]);
});
