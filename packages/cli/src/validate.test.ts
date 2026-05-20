import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runValidate } from "./validate.ts";

const VALID_HEADER =
  '{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
const VALID_USER_MESSAGE =
  '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}';

async function writeFixture(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trail-cli-"));
  const path = join(dir, "trail.jsonl");
  await Bun.write(path, content);
  return path;
}

test("valid trail exits 0 with empty stdout", async () => {
  const path = await writeFixture(`${VALID_HEADER}\n${VALID_USER_MESSAGE}\n`);

  const result = await runValidate([path]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
});

test("multiple positional file arguments exit 1 with usage on stderr", async () => {
  const a = await writeFixture(`${VALID_HEADER}\n`);
  const b = await writeFixture(`${VALID_HEADER}\n`);

  const result = await runValidate([a, b]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("expected exactly one <file> argument");
  expect(result.stderr).toContain("Usage: trail validate");
});

test("missing file argument exits 1 with usage on stderr", async () => {
  const result = await runValidate(["--json"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("missing required argument: <file>");
  expect(result.stderr).toContain("Usage: trail validate");
});

test("unknown flag exits 1 with usage on stderr", async () => {
  const result = await runValidate(["--nope"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("--nope");
  expect(result.stderr).toContain("Usage: trail validate");
});

test("invalid --profile value exits 1 with stderr listing valid options", async () => {
  const path = await writeFixture(`${VALID_HEADER}\n`);

  const result = await runValidate([path, "--profile", "loose"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("strict");
  expect(result.stderr).toContain("reader-tolerant");
});

test("missing file exits 1 with a stderr message", async () => {
  const result = await runValidate(["/definitely/not/a/real/path.jsonl"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("file not found");
  expect(result.stderr).toContain("/definitely/not/a/real/path.jsonl");
});

test("--profile reader-tolerant downgrades unknown payload fields to warnings (exit 0)", async () => {
  const tolerantMessage =
    '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi","extra":"x"}}';
  const path = await writeFixture(`${VALID_HEADER}\n${tolerantMessage}\n`);

  const result = await runValidate([path, "--profile", "reader-tolerant"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("warning reader_tolerant_unknown_payload_field");
});

test("--json prints a JSON array of diagnostics", async () => {
  const badHeader =
    '{"type":"session","schema_version":"0.2.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
  const path = await writeFixture(`${badHeader}\n`);

  const result = await runValidate([path, "--json"]);

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

  const result = await runValidate([path, "--json"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([]);
});

test("invalid trail exits 1 with line-aware text diagnostic", async () => {
  const badHeader =
    '{"type":"session","schema_version":"0.2.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
  const path = await writeFixture(`${badHeader}\n`);

  const result = await runValidate([path]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("error const line 1 /schema_version:");
});

test("same unknown payload field fails strict but passes reader-tolerant", async () => {
  const messageWithExtra =
    '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi","extra":"x"}}';
  const path = await writeFixture(`${VALID_HEADER}\n${messageWithExtra}\n`);

  const strict = await runValidate([path, "--profile", "strict"]);
  expect(strict.exitCode).toBe(1);
  expect(strict.stdout).toContain("error additionalProperties line 2 /payload/extra:");

  const tolerant = await runValidate([path, "--profile", "reader-tolerant"]);
  expect(tolerant.exitCode).toBe(0);
  expect(tolerant.stdout).toContain(
    "warning reader_tolerant_unknown_payload_field line 2 /payload/extra:",
  );
});

test("patch-compatible schema_version fails strict but warns under reader-tolerant", async () => {
  const patchHeader =
    '{"type":"session","schema_version":"0.1.1","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
  const path = await writeFixture(`${patchHeader}\n`);

  const strict = await runValidate([path, "--profile", "strict", "--json"]);
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

  const tolerant = await runValidate([path, "--profile", "reader-tolerant", "--json"]);
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

test("--json under reader-tolerant serializes warnings with full diagnostic shape", async () => {
  const messageWithExtra =
    '{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi","extra":"x"}}';
  const path = await writeFixture(`${VALID_HEADER}\n${messageWithExtra}\n`);

  const result = await runValidate([path, "--profile", "reader-tolerant", "--json"]);

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
