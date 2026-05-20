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

test("invalid trail exits 1 with line-aware text diagnostic", async () => {
  const badHeader =
    '{"type":"session","schema_version":"0.2.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}';
  const path = await writeFixture(`${badHeader}\n`);

  const result = await runValidate([path]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("error const line 1 /schema_version:");
});
