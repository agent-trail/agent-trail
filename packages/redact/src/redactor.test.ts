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

test("redactTrail walks entry source.raw and redacts nested string secrets", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "hello" },
      source: {
        raw: {
          env: { OPENAI_API_KEY: key },
          tags: ["safe", `embedded:${key}`],
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const entryValue = out[1]?.value as {
    source: { raw: { env: { OPENAI_API_KEY: string }; tags: string[] } };
  };
  expect(entryValue.source.raw.env.OPENAI_API_KEY).toBe("[OPENAI_KEY]");
  expect(entryValue.source.raw.tags[1]).toBe("embedded:[OPENAI_KEY]");
  expect(summary.counts.openai_api_key).toBe(2);
  const locations = summary.samples.map((s) => s.location).sort();
  expect(locations).toEqual([
    "records[1].source.raw.env.OPENAI_API_KEY",
    "records[1].source.raw.tags[1]",
  ]);
});

test("redactTrail strips vcs.remote_url from the trail envelope by default", () => {
  const records: JsonlRecord[] = [
    record(1, {
      type: "trail",
      schema_version: "0.1.0",
      id: "trl-1",
      ts: "2026-05-17T14:00:00.000Z",
      producer: "trail-cli/0.3.0",
      vcs: {
        type: "git",
        revision: "a1b2c3d4",
        remote_url: "https://github.com/agent-trail/agent-trail",
      },
    }),
    record(2, {
      type: "session",
      schema_version: "0.1.0",
      id: "sess1",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const envelopeValue = out[0]?.value as { vcs: Record<string, unknown> };
  expect(envelopeValue.vcs).toEqual({ type: "git", revision: "a1b2c3d4" });
  expect(envelopeValue.vcs).not.toHaveProperty("remote_url");
  expect(summary.counts.vcs_remote_url).toBe(1);
  expect(summary.samples.find((s) => s.patternId === "vcs_remote_url")).toMatchObject({
    patternId: "vcs_remote_url",
    location: "records[0].vcs.remote_url",
    after: "[STRIPPED]",
  });
});

test("redactTrail strips vcs.remote_url from the header by default", () => {
  const records: JsonlRecord[] = [
    header({
      vcs: {
        type: "git",
        revision: "a1b2c3d4",
        remote_url: "https://github.com/agent-trail/agent-trail",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as { vcs: Record<string, unknown> };
  expect(headerValue.vcs).toEqual({ type: "git", revision: "a1b2c3d4" });
  expect(headerValue.vcs).not.toHaveProperty("remote_url");
  expect(summary.counts.vcs_remote_url).toBe(1);
  expect(summary.samples.find((s) => s.patternId === "vcs_remote_url")).toMatchObject({
    patternId: "vcs_remote_url",
    location: "records[0].vcs.remote_url",
    after: "[STRIPPED]",
  });
});

test("redactTrail is a no-op on headers without vcs.remote_url", () => {
  const records: JsonlRecord[] = [header({ vcs: { type: "git", revision: "a1b2c3d4" } })];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as { vcs: Record<string, unknown> };
  expect(headerValue.vcs).toEqual({ type: "git", revision: "a1b2c3d4" });
  expect(summary.counts.vcs_remote_url).toBeUndefined();
});

test("redactTrail keeps vcs.remote_url when keepRemoteUrl: true is passed", () => {
  const records: JsonlRecord[] = [
    header({
      vcs: {
        type: "git",
        revision: "a1b2c3d4",
        remote_url: "https://github.com/agent-trail/agent-trail",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { keepRemoteUrl: true });

  const headerValue = out[0]?.value as { vcs: Record<string, unknown> };
  expect(headerValue.vcs).toEqual({
    type: "git",
    revision: "a1b2c3d4",
    remote_url: "https://github.com/agent-trail/agent-trail",
  });
  expect(summary.counts.vcs_remote_url).toBeUndefined();
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
    header({ cwd: "/Users/alice/work" }),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `secret ${key}` },
      source: { raw: { env: { OPENAI_API_KEY: key } } },
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

test("redactTrail skips entry source.raw when includeSourceRaw: false", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "hi" },
      source: { raw: { env: { OPENAI_API_KEY: key } } },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { includeSourceRaw: false });

  const entryValue = out[1]?.value as {
    source: { raw: { env: { OPENAI_API_KEY: string } } };
  };
  expect(entryValue.source.raw.env.OPENAI_API_KEY).toBe(key);
  expect(summary.counts.openai_api_key).toBeUndefined();
});

test("redactTrail truncated output byte length never exceeds outputMaxBytes", () => {
  const big = "X".repeat(20_000);
  for (const limit of [10, 100, 1000, 10_000]) {
    const records: JsonlRecord[] = [
      header(),
      record(2, {
        type: "tool_result",
        id: "evt1",
        ts: "2026-05-22T00:00:01.000Z",
        payload: { for_id: "evt0", ok: true, output: big },
      }),
    ];
    const { records: out } = redactTrail(records, { outputMaxBytes: limit });
    const value = out[1]?.value as { payload: { output: string; truncated?: boolean } };
    const byteLen = new TextEncoder().encode(value.payload.output).byteLength;
    expect(byteLen).toBeLessThanOrEqual(limit);
    expect(value.payload.truncated).toBe(true);
  }
});

test("redactTrail extendPatterns appends caller patterns without dropping defaults", () => {
  const customPattern = {
    id: "internal_token",
    description: "Internal token format",
    regex: /\bINT-[A-Z0-9]{10}\b/g,
    placeholder: "[INTERNAL_TOKEN]",
  };
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "key sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789 and INT-ABCDEFGHIJ",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { extendPatterns: [customPattern] });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toContain("[OPENAI_KEY]");
  expect(text).toContain("[INTERNAL_TOKEN]");
  expect(summary.counts.internal_token).toBe(1);
  expect(summary.counts.openai_api_key).toBe(1);
});

test("redactTrail accepts non-global custom regex without throwing", () => {
  const customPattern = {
    id: "internal",
    description: "Internal id",
    regex: /INT-[A-Z0-9]{6}/,
    placeholder: "[INTERNAL]",
  };
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "first INT-ABCDEF and second INT-ZYXWVU" },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { patterns: [customPattern] });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toBe("first [INTERNAL] and second [INTERNAL]");
  expect(summary.counts.internal).toBe(2);
});

test("redactTrail re-serializes JsonlRecord.raw after redaction", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `secret ${key}` },
    }),
  ];

  const { records: out } = redactTrail(records);

  expect(out[1]?.raw).not.toContain(key);
  expect(out[1]?.raw).toContain("[OPENAI_KEY]");
});

test("redactTrail handles overlapping userSecrets by trying the longest first", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "value abc123 here" },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    userSecrets: ["abc", "abc123"],
  });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toBe("value [USER_SECRET] here");
  expect(text).not.toContain("123");
  expect(summary.counts.user_secret).toBe(1);
});

test("redactTrail normalizes Windows user profile paths to <home>", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "open C:\\Users\\alice\\notes.md please" },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toBe("open <home>\\notes.md please");
  expect(summary.counts.home_path_windows).toBe(1);
});

test("redactTrail counts PERSON name tokens from @redactpii/node as name_pii", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "Hello Jonathan Smith, let's catch up tomorrow." },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).not.toContain("Jonathan");
  expect(text).not.toContain("PERSON_");
  expect(text).toContain("[NAME]");
  expect(summary.counts.name_pii).toBeGreaterThanOrEqual(1);
});

test("redactTrail redacts payload.text on agent_thinking and system_event", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_thinking",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `planning to use ${key}` },
    }),
    record(3, {
      type: "system_event",
      id: "evt2",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        kind: "x-claudecode/diag",
        text: `loaded ${key}`,
        data: { env: { OPENAI_API_KEY: key } },
      },
    }),
    record(4, {
      type: "user_interrupt",
      id: "evt3",
      ts: "2026-05-22T00:00:03.000Z",
      payload: { reason: `paste ${key}` },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const thinking = out[1]?.value as { payload: { text: string } };
  const sysEvent = out[2]?.value as {
    payload: { text: string; data: { env: { OPENAI_API_KEY: string } } };
  };
  const interrupt = out[3]?.value as { payload: { reason: string } };

  expect(thinking.payload.text).toContain("[OPENAI_KEY]");
  expect(sysEvent.payload.text).toContain("[OPENAI_KEY]");
  expect(sysEvent.payload.data.env.OPENAI_API_KEY).toBe("[OPENAI_KEY]");
  expect(interrupt.payload.reason).toContain("[OPENAI_KEY]");
  expect(summary.counts.openai_api_key).toBe(4);
});

test("redactTrail redacts secrets on context_compact/branch_point/branch_summary and user_message.attachments", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "context_compact",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { summary: `compacted with ${key}`, trigger: "auto" },
    }),
    record(3, {
      type: "branch_point",
      id: "evt2",
      ts: "2026-05-22T00:00:02.000Z",
      payload: { from_id: "evt1", reason: `forked because of ${key}` },
    }),
    record(4, {
      type: "branch_summary",
      id: "evt3",
      ts: "2026-05-22T00:00:03.000Z",
      payload: { abandoned_branch_id: "evtX", summary: `abandoned ${key}` },
    }),
    record(5, {
      type: "user_message",
      id: "evt4",
      ts: "2026-05-22T00:00:04.000Z",
      payload: {
        text: "see attachment",
        attachments: [{ kind: "file", uri: `file:///Users/alice/${key}.txt`, name: "secret.txt" }],
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  expect((out[1]?.value as { payload: { summary: string } }).payload.summary).toContain(
    "[OPENAI_KEY]",
  );
  expect((out[2]?.value as { payload: { reason: string } }).payload.reason).toContain(
    "[OPENAI_KEY]",
  );
  expect((out[3]?.value as { payload: { summary: string } }).payload.summary).toContain(
    "[OPENAI_KEY]",
  );
  const uri = (
    out[4]?.value as {
      payload: { attachments: Array<{ uri: string }> };
    }
  ).payload.attachments[0]?.uri;
  expect(uri).not.toContain(key);
  expect(uri).toContain("[OPENAI_KEY]");
  expect(uri).toContain("<home>");
  expect(summary.counts.openai_api_key).toBe(4);
});

test("redactTrail walks record.value.metadata on both header and entries", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header({ metadata: { "com.example.token": key } }),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "hi" },
      metadata: { "com.example.nested": { token: key } },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as { metadata: { "com.example.token": string } };
  expect(headerValue.metadata["com.example.token"]).toBe("[OPENAI_KEY]");
  const entryValue = out[1]?.value as { metadata: { "com.example.nested": { token: string } } };
  expect(entryValue.metadata["com.example.nested"].token).toBe("[OPENAI_KEY]");
  expect(summary.counts.openai_api_key).toBe(2);
});

test("redactTrail normalizes header.source.path", () => {
  const records: JsonlRecord[] = [
    header({ source: { agent: "codex-cli", path: "/Users/alice/.codex/sessions/abc.jsonl" } }),
  ];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as { source: { path: string } };
  expect(headerValue.source.path).toBe("<home>/.codex/sessions/abc.jsonl");
  expect(summary.counts.home_path).toBe(1);
});

test("redactTrail hides full short secrets in sample.before", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "secret abcd here" },
    }),
  ];

  const { summary } = redactTrail(records, { userSecrets: ["abcd"] });

  expect(summary.samples).toHaveLength(1);
  const before = summary.samples[0]?.before ?? "";
  expect(before).not.toContain("abcd");
  expect(before).toMatch(/^<\d+ chars>$/);
});

test("redactTrail resets header content_hash to <pending> after mutation", () => {
  const original = "a".repeat(64);
  const records: JsonlRecord[] = [
    header({ content_hash: original }),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789",
      },
    }),
  ];

  const { records: out } = redactTrail(records);

  const headerValue = out[0]?.value as { content_hash: string };
  expect(headerValue.content_hash).toBe("<pending>");
});

test("redactTrail walks payload of unknown / forward-compatible event types", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "vendor.custom_event",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { description: `secret ${key}`, nested: { token: key } },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    payload: { description: string; nested: { token: string } };
  };
  expect(value.payload.description).toContain("[OPENAI_KEY]");
  expect(value.payload.nested.token).toBe("[OPENAI_KEY]");
  expect(summary.counts.openai_api_key).toBe(2);
});

test("redactTrail keeps URI scheme when redacting Slack webhooks in attachments", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "see attached",
        attachments: [
          {
            kind: "file",
            uri: "https://hooks.slack.com/services/T0AAA111/B0BBB222/aBcDeFgHiJkLmNoPqRsTuVwX",
          },
        ],
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const uri = (out[1]?.value as { payload: { attachments: Array<{ uri: string }> } }).payload
    .attachments[0]?.uri;
  expect(uri).toMatch(/^(https:|file:|sha256:)/);
  expect(uri).toContain("[SLACK_WEBHOOK]");
  expect(summary.counts.slack_webhook).toBe(1);
});

test("redactTrail preserves header content_hash when no redactions occur", () => {
  const finalized = "a".repeat(64);
  const records: JsonlRecord[] = [
    header({ content_hash: finalized }),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "nothing sensitive here" },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as { content_hash: string };
  expect(headerValue.content_hash).toBe(finalized);
  expect(summary.counts).toEqual({});
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
