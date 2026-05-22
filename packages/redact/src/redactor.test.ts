import { expect, test } from "bun:test";
import type { JsonlRecord } from "@agent-trail/core";
import { redactTrail } from "./redactor.ts";

function record(line: number, value: Record<string, unknown>): JsonlRecord {
  return { line, raw: JSON.stringify(value), value };
}

function header(overrides: Record<string, unknown> = {}): JsonlRecord {
  return record(1, {
    type: "session",
    schema_version: "0.1.0",
    id: "sess1",
    ts: "2026-05-22T00:00:00.000Z",
    agent: { name: "codex-cli" },
    ...overrides,
  });
}

test("redactTrail redacts an OpenAI api key in agent_message.payload.text", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `here is the key ${key} use it well` },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const agentValue = out[1]?.value as { payload: { text: string } };
  expect(agentValue.payload.text).toBe("here is the key [OPENAI_KEY] use it well");
  expect(agentValue.payload.text).not.toContain(key);
  expect(summary.counts).toEqual({ openai_api_key: 1 });
  expect(summary.samples).toHaveLength(1);
  expect(summary.samples[0]).toMatchObject({
    patternId: "openai_api_key",
    location: "records[1].payload.text",
    after: "[OPENAI_KEY]",
  });
});

test("sample.before is a sanitized excerpt that never leaks the full secret", () => {
  const key = `sk-proj-${"X".repeat(256)}`;
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `here we go ${key} all done` },
    }),
  ];

  const { summary } = redactTrail(records);

  expect(summary.samples).toHaveLength(1);
  const sample = summary.samples[0]!;
  expect(sample.before.length).toBeLessThanOrEqual(80);
  expect(sample.before).not.toContain(key);
  expect(sample.before).toContain("…");
  expect(sample.after).toBe("[OPENAI_KEY]");
});

test("redactTrail applies user-supplied exact secrets before regex patterns", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "the token is hunter2.special and that's it" },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    userSecrets: ["hunter2.special"],
  });

  const value = out[1]?.value as { payload: { text: string } };
  expect(value.payload.text).toBe("the token is [USER_SECRET] and that's it");
  expect(summary.counts).toEqual({ user_secret: 1 });
  expect(summary.samples[0]).toMatchObject({
    patternId: "user_secret",
    after: "[USER_SECRET]",
    location: "records[1].payload.text",
  });
});

test("redactTrail walks source.metadata.raw and redacts nested string secrets", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header({
      source: {
        metadata: {
          raw: {
            env: { OPENAI_API_KEY: key },
            tags: ["safe", `embedded:${key}`],
          },
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as {
    source: { metadata: { raw: { env: { OPENAI_API_KEY: string }; tags: string[] } } };
  };
  expect(headerValue.source.metadata.raw.env.OPENAI_API_KEY).toBe("[OPENAI_KEY]");
  expect(headerValue.source.metadata.raw.tags[1]).toBe("embedded:[OPENAI_KEY]");
  expect(summary.counts.openai_api_key).toBe(2);
  const locations = summary.samples.map((s) => s.location).sort();
  expect(locations).toEqual([
    "records[0].source.metadata.raw.env.OPENAI_API_KEY",
    "records[0].source.metadata.raw.tags[1]",
  ]);
});

test("redactTrail normalizes /Users/<name> and /home/<name> paths to <home>", () => {
  const records: JsonlRecord[] = [
    header({ cwd: "/Users/alice/projects/agent-trail" }),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "see /home/bob/work/notes.md" },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as { cwd: string };
  expect(headerValue.cwd).toBe("<home>/projects/agent-trail");
  const userValue = out[1]?.value as { payload: { text: string } };
  expect(userValue.payload.text).toBe("see <home>/work/notes.md");
  expect(summary.counts.home_path).toBe(2);
});

test("redactTrail redacts PII (email, phone, ssn) via @redactpii/node", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "Contact alice@example.com or 415-555-2671. SSN 123-45-6789." },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as { payload: { text: string } };
  expect(value.payload.text).not.toContain("alice@example.com");
  expect(value.payload.text).not.toContain("415-555-2671");
  expect(value.payload.text).not.toContain("123-45-6789");
  expect(value.payload.text).toContain("[EMAIL]");
  expect(value.payload.text).toContain("[PHONE]");
  expect(value.payload.text).toContain("[SSN]");
  expect(summary.counts.email_pii).toBe(1);
  expect(summary.counts.phone_pii).toBeGreaterThanOrEqual(1);
  expect(summary.counts.ssn_pii).toBeGreaterThanOrEqual(1);
});

test("redactTrail truncates tool_result.output exceeding outputMaxBytes and sets truncated=true", () => {
  const big = "X".repeat(20_000);
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_result",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        for_id: "evtcall",
        ok: true,
        output: big,
        overflow_ref: "sha256:abc",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    payload: { output: string; truncated?: boolean; overflow_ref: string };
  };
  expect(value.payload.output.length).toBeLessThanOrEqual(10_240);
  expect(value.payload.output.length).toBeLessThan(big.length);
  expect(value.payload.truncated).toBe(true);
  expect(value.payload.overflow_ref).toBe("sha256:abc");
  expect(summary.counts.output_truncated).toBe(1);
});

test("redactTrail does not mutate input records", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header({
      cwd: "/Users/alice/work",
      source: { metadata: { raw: { env: { OPENAI_API_KEY: key } } } },
    }),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `secret ${key}` },
    }),
  ];
  const snapshot = structuredClone(records);

  redactTrail(records);

  expect(records).toEqual(snapshot);
});

test("redactTrail redacts secrets across tool_call.args, tool_result.output, and tool_result.error", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_call",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        tool: "shell_command",
        args: { command: `OPENAI_API_KEY=${key} curl example.com`, cwd: "/Users/alice/x" },
      },
    }),
    record(3, {
      type: "tool_call",
      id: "evt2",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        tool: "mcp_call",
        args: { server: "s", tool: "t", headers: { Authorization: `Bearer ${key}` } },
      },
    }),
    record(4, {
      type: "tool_result",
      id: "evt3",
      ts: "2026-05-22T00:00:03.000Z",
      payload: {
        for_id: "evt1",
        ok: false,
        output: `printed ${key}`,
        error: `auth failed: ${key}`,
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const call1 = out[1]?.value as { payload: { args: { command: string; cwd: string } } };
  expect(call1.payload.args.command).toContain("[OPENAI_KEY]");
  expect(call1.payload.args.command).not.toContain(key);
  expect(call1.payload.args.cwd).toBe("<home>/x");

  const call2 = out[2]?.value as { payload: { args: { headers: { Authorization: string } } } };
  expect(call2.payload.args.headers.Authorization).toContain("[OPENAI_KEY]");

  const result = out[3]?.value as { payload: { output: string; error: string } };
  expect(result.payload.output).toContain("[OPENAI_KEY]");
  expect(result.payload.error).toContain("[OPENAI_KEY]");
  expect(result.payload.output).not.toContain(key);
  expect(result.payload.error).not.toContain(key);

  expect(summary.counts.openai_api_key).toBeGreaterThanOrEqual(4);
});

test("redactTrail bounds sample list to options.maxSamples while counts stay accurate", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const messages = Array.from({ length: 25 }, (_, i) =>
    record(2 + i, {
      type: "agent_message",
      id: `evt${i}`,
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `entry ${i} ${key}` },
    }),
  );

  const { summary } = redactTrail([header(), ...messages], { maxSamples: 5 });

  expect(summary.counts.openai_api_key).toBe(25);
  expect(summary.samples).toHaveLength(5);
});

test("redactTrail returns input records and empty summary when no secrets present", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "hello world" },
    }),
    record(3, {
      type: "agent_message",
      id: "evt2",
      ts: "2026-05-22T00:00:02.000Z",
      payload: { text: "general greeting back" },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  expect(out).toEqual(records);
  expect(summary).toEqual({ counts: {}, samples: [] });
});
