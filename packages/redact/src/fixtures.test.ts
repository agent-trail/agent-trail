import { expect, test } from "bun:test";
import { parseJsonlString } from "@agent-trail/core";
import { redactTrail } from "./redactor.ts";

const FIXTURES_DIR = new URL("../../../tests/fixtures/redaction/", import.meta.url);

async function loadFixture(name: string) {
  const path = new URL(`${name}.in.jsonl`, FIXTURES_DIR);
  const text = await Bun.file(path).text();
  return parseJsonlString(text);
}

function serialize(records: { value: Record<string, unknown> }[]): string {
  return records.map((r) => JSON.stringify(r.value)).join("\n");
}

test("fixture: clean trail is left unchanged", async () => {
  const records = await loadFixture("clean");
  const { records: out, summary } = redactTrail(records);
  expect(summary.counts).toEqual({});
  expect(summary.samples).toEqual([]);
  expect(serialize(out)).toBe(serialize(records));
});

test("fixture: openai-key is redacted in agent_message text", async () => {
  const records = await loadFixture("openai-key");
  const { records: out, summary } = redactTrail(records);
  expect(serialize(out)).not.toContain("sk-proj-");
  expect(summary.counts.openai_api_key).toBe(1);
});

test("fixture: aws-key is redacted in tool_call args and tool_result output", async () => {
  const records = await loadFixture("aws-key");
  const { records: out, summary } = redactTrail(records);
  expect(serialize(out)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  expect(summary.counts.aws_access_key).toBe(2);
});

test("fixture: pii email/phone/ssn are routed through @redactpii/node", async () => {
  const records = await loadFixture("pii");
  const { records: out, summary } = redactTrail(records);
  const serialized = serialize(out);
  expect(serialized).not.toContain("alice@example.com");
  expect(serialized).not.toContain("415-555-2671");
  expect(serialized).not.toContain("123-45-6789");
  expect(summary.counts.email_pii).toBe(1);
  expect(summary.counts.phone_pii).toBeGreaterThanOrEqual(1);
  expect(summary.counts.ssn_pii).toBeGreaterThanOrEqual(1);
});

test("fixture: source-raw-secret is walked recursively", async () => {
  const records = await loadFixture("source-raw-secret");
  const { records: out, summary } = redactTrail(records);
  expect(serialize(out)).not.toContain("sk-proj-");
  expect(summary.counts.openai_api_key).toBe(2);
  const locations = summary.samples.map((s) => s.location);
  expect(locations).toContain("records[1].source.raw.env.OPENAI_API_KEY");
  expect(locations).toContain("records[1].source.raw.tags[1]");
});

test("fixture: home-paths normalize to <home>", async () => {
  const records = await loadFixture("home-paths");
  const { records: out, summary } = redactTrail(records);
  const serialized = serialize(out);
  expect(serialized).not.toContain("/Users/alice");
  expect(serialized).not.toContain("/home/bob");
  expect(serialized).toContain("<home>");
  expect(summary.counts.home_path).toBe(2);
});

test("fixture: large-output exceeds 10KB and is truncated", async () => {
  const records = await loadFixture("large-output");
  const { records: out, summary } = redactTrail(records);
  const value = out[1]?.value as { payload: { output: string; truncated?: boolean } };
  expect(value.payload.output.length).toBeLessThanOrEqual(10_240);
  expect(value.payload.truncated).toBe(true);
  expect(summary.counts.output_truncated).toBe(1);
});
