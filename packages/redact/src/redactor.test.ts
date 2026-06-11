import { expect, test } from "bun:test";
import { type JsonlRecord, validateTrailString } from "@agent-trail/core";
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
  expect((out[1]?.value as { meta?: { redaction_count?: number } }).meta?.redaction_count).toBe(1);
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

test("redactTrail redacts session_metadata_update values but preserves field and reason", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "session_metadata_update",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        field: "name",
        value: "secret-alpha",
        previous_value: "secret-beta",
        reason: "external",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    userSecrets: ["secret-alpha", "secret-beta", "external"],
  });

  const value = out[1]?.value as {
    payload: { field: string; value: string; previous_value: string; reason: string };
  };
  expect(value.payload).toEqual({
    field: "name",
    value: "[USER_SECRET]",
    previous_value: "[USER_SECRET]",
    reason: "external",
  });
  expect(summary.counts.user_secret).toBe(2);
});

test("redactTrail redacts session header and trail envelope metadata fields", async () => {
  const records: JsonlRecord[] = [
    record(1, {
      type: "trail",
      schema_version: "0.1.0",
      id: "00000000-0000-0000-0000-000000000001",
      name: "secret-delta",
      description: "secret-epsilon",
      tags: ["public", "secret-zeta"],
      ts: "2026-05-22T00:00:00.000Z",
      producer: "trail-cli/0.3.0",
    }),
    record(2, {
      type: "session",
      schema_version: "0.1.0",
      id: "00000000-0000-0000-0000-000000000002",
      name: "secret-alpha",
      description: "secret-beta",
      tags: ["keep", "secret-gamma"],
      ts: "2026-05-22T00:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    userSecrets: [
      "secret-alpha",
      "secret-beta",
      "secret-gamma",
      "secret-delta",
      "secret-epsilon",
      "secret-zeta",
    ],
  });

  const envelopeValue = out[0]?.value as {
    name: string;
    description: string;
    tags: string[];
  };
  const headerValue = out[1]?.value as {
    name: string;
    description: string;
    tags: string[];
  };
  expect(envelopeValue.name).toBe("[USER_SECRET]");
  expect(envelopeValue.description).toBe("[USER_SECRET]");
  expect(envelopeValue.tags).toEqual(["public", "[USER_SECRET]"]);
  expect(headerValue.name).toBe("[USER_SECRET]");
  expect(headerValue.description).toBe("[USER_SECRET]");
  expect(headerValue.tags).toEqual(["keep", "[USER_SECRET]"]);
  expect(summary.counts.user_secret).toBe(6);

  const jsonl = `${out.map((r) => JSON.stringify(r.value)).join("\n")}\n`;
  const diagnostics = await validateTrailString(jsonl);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("redactTrail walks nested session_metadata_update value objects", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "session_metadata_update",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        field: "x-codex/thread_goal",
        value: { summary: "secret-alpha", steps: ["keep", "secret-beta"] },
        previous_value: { nested: { summary: "secret-gamma" } },
        reason: "ai_generated",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    userSecrets: ["secret-alpha", "secret-beta", "secret-gamma", "ai_generated"],
  });

  const value = out[1]?.value as {
    payload: {
      field: string;
      value: { summary: string; steps: string[] };
      previous_value: { nested: { summary: string } };
      reason: string;
    };
  };
  expect(value.payload).toEqual({
    field: "x-codex/thread_goal",
    value: { summary: "[USER_SECRET]", steps: ["keep", "[USER_SECRET]"] },
    previous_value: { nested: { summary: "[USER_SECRET]" } },
    reason: "ai_generated",
  });
  expect(summary.counts.user_secret).toBe(3);
});

test("redactTrail redacts tool_call_aborted blocked_by but preserves control fields", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_call_aborted",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        scope: "tool_call",
        reason: "hook_blocked",
        for_id: "call1",
        blocked_by: "secret-policy",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    userSecrets: ["secret-policy", "hook_blocked", "tool_call", "call1"],
  });

  const value = out[1]?.value as {
    payload: { scope: string; reason: string; for_id: string; blocked_by: string };
  };
  expect(value.payload).toEqual({
    scope: "tool_call",
    reason: "hook_blocked",
    for_id: "call1",
    blocked_by: "[USER_SECRET]",
  });
  expect(summary.counts.user_secret).toBe(1);
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
      id: "00000000-0000-0000-0000-00000000d0aa",
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

test("redactTrail strips vcs_commit repo by default", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "system_event",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        kind: "vcs_commit",
        data: {
          sha: "a1b2c3d",
          tool_call_id: "call1",
          branch: "main",
          repo: "https://github.com/private/repo",
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    meta?: { redaction_count?: number };
    payload: { data: Record<string, unknown> };
  };
  expect(value.payload.data).toEqual({
    sha: "a1b2c3d",
    tool_call_id: "call1",
    branch: "main",
  });
  expect(value.meta?.redaction_count).toBe(1);
  expect(summary.counts.vcs_remote_url).toBe(1);
  expect(summary.samples.find((s) => s.patternId === "vcs_remote_url")).toMatchObject({
    patternId: "vcs_remote_url",
    location: "records[1].payload.data.repo",
    after: "[STRIPPED]",
  });
});

test("redactTrail keeps vcs_commit repo when keepRemoteUrl: true is passed", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "system_event",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        kind: "vcs_commit",
        data: {
          sha: "a1b2c3d",
          tool_call_id: "call1",
          repo: "https://github.com/private/repo",
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { keepRemoteUrl: true });

  const value = out[1]?.value as { payload: { data: Record<string, unknown> } };
  expect(value.payload.data.repo).toBe("https://github.com/private/repo");
  expect(summary.counts.vcs_remote_url).toBeUndefined();
});

test("redactTrail normalizes vcs worktree paths on headers and trail envelopes", () => {
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
        worktree: {
          name: "topic",
          path: "/Users/alice/project/.worktrees/topic",
          original_cwd: "/Users/alice/project",
        },
      },
    }),
    header({
      vcs: {
        type: "git",
        revision: "a1b2c3d4",
        worktree: {
          name: "topic",
          path: "/Users/alice/project/.worktrees/topic",
          original_cwd: "/Users/alice/project",
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const trailValue = out[0]?.value as { vcs: { worktree: Record<string, unknown> } };
  const headerValue = out[1]?.value as { vcs: { worktree: Record<string, unknown> } };
  expect(trailValue.vcs.worktree.path).toBe("<home>/project/.worktrees/topic");
  expect(trailValue.vcs.worktree.original_cwd).toBe("<home>/project");
  expect(headerValue.vcs.worktree.path).toBe("<home>/project/.worktrees/topic");
  expect(headerValue.vcs.worktree.original_cwd).toBe("<home>/project");
  expect(summary.counts.home_path).toBe(4);
});

test("redactTrail does not mutate schema-controlled vcs fields", async () => {
  const commit = "abcdef0123456789abcdef0123456789abcdef01";
  const records: JsonlRecord[] = [
    header({
      id: "00000000-0000-0000-0000-00000000d0aa",
      vcs: {
        type: "git",
        revision: commit,
        head_commit: commit,
        worktree: {
          name: "topic",
          path: "/Users/alice/project/.worktrees/topic",
          original_cwd: "/Users/alice/project",
          original_head_commit: commit,
        },
      },
    }),
  ];

  const { records: out } = redactTrail(records, { userSecrets: ["git", "abcdef0"] });

  const value = out[0]?.value as {
    vcs: { type: string; head_commit: string; worktree: Record<string, unknown> };
  };
  expect(value.vcs.type).toBe("git");
  expect(value.vcs.head_commit).toBe(commit);
  expect(value.vcs.worktree.original_head_commit).toBe(commit);
  const jsonl = `${out.map((r) => JSON.stringify(r.value)).join("\n")}\n`;
  const diagnostics = await validateTrailString(jsonl);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("redactTrail does not mutate schema-controlled vcs.worktree metadata fields", async () => {
  const commit = "abcdef0123456789abcdef0123456789abcdef01";
  const records: JsonlRecord[] = [
    header({ id: "00000000-0000-0000-0000-00000000d0aa" }),
    record(2, {
      type: "session_metadata_update",
      id: "00000000-0000-0000-0000-00000000d0ab",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        field: "vcs.worktree",
        reason: "runtime_inferred",
        value: {
          name: "topic",
          path: "/Users/alice/project/.worktrees/topic",
          original_cwd: "/Users/alice/project",
          original_head_commit: commit,
        },
      },
    }),
  ];

  const { records: out } = redactTrail(records, { userSecrets: ["abcdef0"] });

  const value = out[1]?.value as {
    payload: { value: { path: string; original_cwd: string; original_head_commit: string } };
  };
  expect(value.payload.value.path).toBe("<home>/project/.worktrees/topic");
  expect(value.payload.value.original_cwd).toBe("<home>/project");
  expect(value.payload.value.original_head_commit).toBe(commit);
  const jsonl = `${out.map((r) => JSON.stringify(r.value)).join("\n")}\n`;
  const diagnostics = await validateTrailString(jsonl);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
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

test("redactTrail preserves default allowlisted automation emails", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "actions@github.com noreply@example.com actions@private.example user@users.noreply.github.com alice@example.com",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toContain("actions@github.com");
  expect(text).toContain("user@users.noreply.github.com");
  expect(text).not.toContain("noreply@example.com");
  expect(text).not.toContain("actions@private.example");
  expect(text).not.toContain("alice@example.com");
  expect(text).toContain("[EMAIL]");
  expect(summary.counts.email_pii).toBe(3);
  expect(summary.counts.allowlisted_skip).toBe(2);
});

test("redactTrail ignores partial email allowlist shorthands", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "alice@gmail.com bob@example.com" },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    pii: { emailAllowlist: ["@gmail.com", "alice@"] },
  });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).not.toContain("alice@gmail.com");
  expect(text).not.toContain("bob@example.com");
  expect(summary.counts.email_pii).toBe(2);
  expect(summary.counts.allowlisted_skip).toBeUndefined();
});

test("redactTrail phone PII avoids IP and version false positives", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "ip 192.168.001.0001 version 1.234.567.8901 call 415-555-2671 or (415) 555-2672 or +1-415-555-2673",
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toContain("192.168.001.0001");
  expect(text).toContain("1.234.567.8901");
  expect(text).not.toContain("415-555-2671");
  expect(text).not.toContain("(415) 555-2672");
  expect(text).not.toContain("+1-415-555-2673");
  expect(text).toContain("[PHONE]");
  expect(summary.counts.phone_pii).toBe(3);
});

test("redactTrail applies custom PII labels", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "employee EMP-123456 opened the ticket" },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    pii: { customLabels: { employee_id: "EMP-\\d{6}" } },
  });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toBe("employee [REDACTED_EMPLOYEE_ID] opened the ticket");
  expect(summary.counts.employee_id_pii).toBe(1);
});

test("redactTrail rejects unsafe custom label regexes", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "EMP-123456" },
    }),
  ];

  expect(() =>
    redactTrail(records, {
      pii: { customLabels: { employee_id: "^(EMP-\\d+)+$" } },
    }),
  ).toThrow("nested unbounded quantifiers");
});

test("redactTrail preserves allowed secrets in credential-looking fields", () => {
  const allowed = "sk-proj-AllowedAllowedAllowedAllowedAllowedAllowed";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_call",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { args: { api_key: allowed, command: allowed } },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { allowedSecrets: [allowed] });

  const value = out[1]?.value as { payload: { args: { api_key: string; command: string } } };
  expect(value.payload.args.api_key).toBe(allowed);
  expect(value.payload.args.command).toBe(allowed);
  expect(summary.counts.allowlisted_skip).toBe(2);
  expect(summary.counts.credential_context).toBeUndefined();
  expect(summary.counts.openai_api_key).toBeUndefined();
});

test("redactTrail preserves allowed secrets redacted by PII library rules", () => {
  const ssn = "123-45-6789";
  const card = "4111 1111 1111 1111";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `SSN ${ssn} and card ${card}` },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    allowedSecrets: [ssn, card],
  });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toContain(ssn);
  expect(text).toContain(card);
  expect(summary.counts.allowlisted_skip).toBe(2);
  expect(summary.counts.ssn_pii).toBeUndefined();
  expect(summary.counts.credit_card_pii).toBeUndefined();
});

test("redactTrail allowed PII sentinels avoid existing text collisions", () => {
  const ssn = "123-45-6789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: `existing \u0000AGENT_TRAIL_ALLOWED_PII_0\u0000 and \u0000AGENT_TRAIL_ALLOWED_PII_1\u0000 keep ${ssn}`,
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { allowedSecrets: [ssn] });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toContain("\u0000AGENT_TRAIL_ALLOWED_PII_0\u0000");
  expect(text).toContain("\u0000AGENT_TRAIL_ALLOWED_PII_1\u0000");
  expect(text).toContain(ssn);
  expect(summary.counts.allowlisted_skip).toBe(1);
  expect(summary.counts.ssn_pii).toBeUndefined();
});

test("redactTrail does not preserve larger detector matches for allowed-secret substrings", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `key ${key}` },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { allowedSecrets: ["AbCdEf"] });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).not.toContain(key);
  expect(text).toContain("[OPENAI_KEY]");
  expect(summary.counts.openai_api_key).toBe(1);
  expect(summary.counts.allowlisted_skip).toBeUndefined();
});

test("redactTrail does not let a whole-leaf allowed secret bypass other detectors", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const allowedLeaf = `safe wrapper alice@example.com ${key}`;
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: allowedLeaf },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { allowedSecrets: [allowedLeaf] });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toBe("safe wrapper [EMAIL] [OPENAI_KEY]");
  expect(summary.counts.email_pii).toBe(1);
  expect(summary.counts.openai_api_key).toBe(1);
  expect(summary.counts.allowlisted_skip).toBeUndefined();
});

test("redactTrail allowed-secret sentinels do not collide with existing text", () => {
  const allowed = "sk-proj-AllowedAllowedAllowedAllowedAllowedAllowed";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `prefix [ALLOWED_SECRET_0_0] keep ${allowed}` },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { allowedSecrets: [allowed] });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toBe(`prefix [ALLOWED_SECRET_0_0] keep ${allowed}`);
  expect(summary.counts.allowlisted_skip).toBe(1);
});

test("redactTrail allowed-secret protection is not affected by later pattern placeholders", () => {
  const allowed = "sk-proj-AllowedAllowedAllowedAllowedAllowedAllowed";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `keep ${allowed} redact SECRET` },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    allowedSecrets: [allowed],
    extendPatterns: [
      {
        id: "marker",
        description: "marker",
        regex: /SECRET/g,
        placeholder: "[ALLOWED_SECRET_0_0]",
      },
    ],
  });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toBe(`keep ${allowed} redact [ALLOWED_SECRET_0_0]`);
  expect(summary.counts.allowlisted_skip).toBe(1);
  expect(summary.counts.marker).toBe(1);
});

test("redactTrail expands custom replacements like native String.replace", () => {
  const source = "abc123def";
  const placeholder = "$`|$&|$'|$1|$2|$10|$$";
  const regex = /(\d+)/g;
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: source },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    extendPatterns: [
      {
        id: "number_marker",
        description: "number marker",
        regex,
        placeholder,
      },
    ],
  });

  const text = (out[1]?.value as { payload: { text: string } }).payload.text;
  expect(text).toBe(source.replace(regex, placeholder));
  expect(summary.counts.number_marker).toBe(1);
});

test("redactTrail redacts only the password segment in credentialed URIs", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_call",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        tool: "shell",
        args: {
          command: "psql postgres://app_user:s3cr3t-pa55@db.internal:5432/app?sslmode=require",
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as { payload: { args: { command: string } } };
  expect(value.payload.args.command).toBe(
    "psql postgres://app_user:[URI_PASSWORD]@db.internal:5432/app?sslmode=require",
  );
  expect(summary.counts.credentialed_uri).toBe(1);
});

test("redactTrail redacts password segments in DSNs and connection strings", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_call",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        tool: "shell",
        args: {
          command: [
            "java -Ddb=jdbc:postgresql://db.internal/app?user=app&password=jdbcSecret123&ssl=true",
            "sqlcmd Server=db.internal;UID=sa;PWD=sqlSecret123;",
            "odbc Driver=Postgres;Server=db.internal;Password=keywordSecret123;User=app;",
            "DATABASE_URL=postgres://app:databaseSecret123@db.internal/app",
          ].join(" "),
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as { payload: { args: { command: string } } };
  expect(value.payload.args.command).toContain("password=[DSN_PASSWORD]");
  expect(value.payload.args.command).toContain("PWD=[DSN_PASSWORD]");
  expect(value.payload.args.command).toContain("Password=[DSN_PASSWORD]");
  expect(value.payload.args.command).toContain(
    "DATABASE_URL=postgres://app:[DATABASE_URL_PASSWORD]@db.internal/app",
  );
  expect(summary.counts.dsn_password).toBe(3);
  expect(summary.counts.database_url).toBe(1);
});

test("redactTrail redacts lowercase env and JSON credential fields in text", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: [
          "db_password=lowercase.secret.12345",
          "pg_url=postgres://app:pgSecret123@db.internal/app",
          '{"password":"json.secret.12345","db_url":"postgres://app:jsonSecret123@db.internal/app"}',
        ].join(" "),
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as { payload: { text: string } };
  expect(value.payload.text).toContain("db_password=[ENV_SECRET]");
  expect(value.payload.text).toContain("pg_url=[ENV_SECRET]");
  expect(value.payload.text).toContain('"password":"[JSON_SECRET]"');
  expect(value.payload.text).toContain('"db_url":"[JSON_SECRET]"');
  expect(summary.counts.env_assignment).toBe(2);
  expect(summary.counts.json_credential_field).toBe(2);
});

test("redactTrail redacts credential-keyed object values without mutating opaque IDs", () => {
  const uuid = "00000000-0000-0000-0000-00000000abcd";
  const hash = `sha256:${"a".repeat(64)}`;
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_result",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        for_id: "call1",
        ok: true,
        output: "done",
        meta: {
          password: "novel internal password",
          token: "bare-token-internal-secret",
          API_KEY: "uppercase-api-key-secret",
          AUTH_TOKEN: "uppercase-auth-token-secret",
          api_token: "opaque-internal-token-value",
          apiKey: "camel-case-internal-secret",
          accessToken: uuid,
          privateKey: hash,
          id: uuid,
          content_hash: hash,
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    payload: {
      meta: {
        password: string;
        token: string;
        API_KEY: string;
        AUTH_TOKEN: string;
        api_token: string;
        apiKey: string;
        accessToken: string;
        privateKey: string;
        id: string;
        content_hash: string;
      };
    };
  };
  expect(value.payload.meta.password).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.meta.token).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.meta.API_KEY).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.meta.AUTH_TOKEN).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.meta.api_token).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.meta.apiKey).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.meta.accessToken).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.meta.privateKey).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.meta.id).toBe(uuid);
  expect(value.payload.meta.content_hash).toBe(hash);
  expect(summary.counts.credential_context).toBe(8);
});

test("redactTrail replaces whole credential-keyed values after partial pattern redaction", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_call",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        tool: "shell_command",
        args: {
          password: "Bearer abcdefABCDEF0123456789xyzXYZ extra-tail-secret",
          authorization: "Bearer abcdefABCDEF0123456789xyzXYZ extra-tail-secret",
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);
  const value = out[1]?.value as {
    payload: { args: { password: string; authorization: string } };
  };

  expect(value.payload.args.password).toBe("[CREDENTIAL_VALUE]");
  expect(value.payload.args.authorization).toBe("Bearer [TOKEN] extra-tail-secret");
  expect(summary.counts.bearer_token).toBe(2);
  expect(summary.counts.credential_context).toBe(1);
});

test("redactTrail only applies entropy redaction when explicitly enabled", () => {
  const token = "zQ9mK2pL8vR4sT7xY1aB3cD5eF6gH7jK";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `novel token ${token}` },
    }),
  ];

  const disabled = redactTrail(records);
  const disabledValue = disabled.records[1]?.value as { payload: { text: string } };
  expect(disabledValue.payload.text).toContain(token);
  expect(disabled.summary.counts.high_entropy_token).toBeUndefined();

  const enabled = redactTrail(records, { enableEntropyRedaction: true });
  const enabledValue = enabled.records[1]?.value as { payload: { text: string } };
  expect(enabledValue.payload.text).toBe("novel token [HIGH_ENTROPY_SECRET]");
  expect(enabled.summary.counts.high_entropy_token).toBe(1);
});

test("redactTrail entropy redaction skips opaque hash and UUID fields", () => {
  const uuid = "00000000-0000-0000-0000-00000000abcd";
  const hash = `sha256:${"b".repeat(64)}`;
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_result",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        for_id: "call1",
        ok: true,
        output: "done",
        meta: {
          id: uuid,
          content_hash: hash,
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { enableEntropyRedaction: true });

  const value = out[1]?.value as { payload: { meta: { id: string; content_hash: string } } };
  expect(value.payload.meta.id).toBe(uuid);
  expect(value.payload.meta.content_hash).toBe(hash);
  expect(summary.counts.high_entropy_token).toBeUndefined();
});

test("redactTrail truncates tool_result.output exceeding outputMaxBytes and sets truncated=true", () => {
  const big = "X".repeat(20_000);
  const overflowRef = `sha256:${"a".repeat(64)}`;
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
        overflow_ref: overflowRef,
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    meta?: { redaction_count?: number };
    payload: { output: string; truncated?: boolean; output_size?: number; overflow_ref: string };
  };
  expect(value.payload.output.length).toBeLessThanOrEqual(10_240);
  expect(value.payload.output.length).toBeLessThan(big.length);
  expect(value.payload.truncated).toBe(true);
  expect(value.payload.output_size).toBe(new TextEncoder().encode(big).byteLength);
  expect(value.payload.overflow_ref).toBe(overflowRef);
  expect(value.meta?.redaction_count).toBe(1);
  expect(summary.counts.output_truncated).toBe(1);
});

test("redactTrail strips non-sha256 overflow_ref values and preserves sha256 refs", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_result",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        for_id: "evtcall1",
        ok: true,
        output: "truncated local output",
        truncated: true,
        output_size: 1234,
        overflow_ref: "file:///Users/alice/output.txt",
      },
    }),
    record(3, {
      type: "tool_result",
      id: "evt2",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "evtcall2",
        ok: true,
        output: "truncated content-addressed output",
        truncated: true,
        output_size: 5678,
        overflow_ref: `sha256:${"b".repeat(64)}`,
      },
    }),
    record(4, {
      type: "tool_result",
      id: "evt3",
      ts: "2026-05-22T00:00:03.000Z",
      payload: {
        for_id: "evtcall3",
        ok: true,
        output: "malformed content ref",
        truncated: true,
        output_size: 90,
        overflow_ref: "sha256:file:///Users/alice/output.txt",
      },
    }),
    record(5, {
      type: "tool_result",
      id: "evt4",
      ts: "2026-05-22T00:00:04.000Z",
      payload: {
        for_id: "evtcall4",
        ok: true,
        output: "uppercase digest",
        truncated: true,
        output_size: 90,
        overflow_ref: `sha256:${"A".repeat(64)}`,
      },
    }),
    record(6, {
      type: "tool_result",
      id: "evt5",
      ts: "2026-05-22T00:00:05.000Z",
      payload: {
        for_id: "evtcall5",
        ok: true,
        output: "short digest",
        truncated: true,
        output_size: 90,
        overflow_ref: `sha256:${"a".repeat(63)}`,
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const local = out[1]?.value as {
    meta?: { redaction_count?: number };
    payload: { truncated: boolean; output_size: number; overflow_ref?: string };
  };
  const contentAddressed = out[2]?.value as { payload: { overflow_ref?: string } };
  const malformed = out[3]?.value as {
    meta?: { redaction_count?: number };
    payload: { overflow_ref?: string };
  };
  const uppercase = out[4]?.value as {
    meta?: { redaction_count?: number };
    payload: { overflow_ref?: string };
  };
  const short = out[5]?.value as {
    meta?: { redaction_count?: number };
    payload: { overflow_ref?: string };
  };
  expect(local.payload.overflow_ref).toBeUndefined();
  expect(local.payload.truncated).toBe(true);
  expect(local.payload.output_size).toBe(1234);
  expect(local.meta?.redaction_count).toBe(1);
  expect(contentAddressed.payload.overflow_ref).toBe(`sha256:${"b".repeat(64)}`);
  expect(malformed.payload.overflow_ref).toBeUndefined();
  expect(malformed.meta?.redaction_count).toBe(1);
  expect(uppercase.payload.overflow_ref).toBeUndefined();
  expect(uppercase.meta?.redaction_count).toBe(1);
  expect(short.payload.overflow_ref).toBeUndefined();
  expect(short.meta?.redaction_count).toBe(1);
  expect(summary.counts.overflow_ref_stripped).toBe(4);
  expect(
    summary.samples.find((sample) => sample.patternId === "overflow_ref_stripped")?.before,
  ).toBe("[overflow_ref]");
});

test("redactTrail truncates user_query_response answer strings exceeding outputMaxBytes", () => {
  const bigSelected = "S".repeat(20_000);
  const bigOther = "O".repeat(20_000);
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query",
      id: "query1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        questions: [{ id: "token", question: "Paste output" }],
      },
    }),
    record(3, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "query1",
        answers: {
          token: { selected: [bigSelected], other: bigOther },
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[2]?.value as {
    meta?: { redaction_count?: number };
    payload: {
      answers: {
        token: { selected: string[]; other: string };
      };
    };
  };
  const selected = value.payload.answers.token.selected[0];
  expect(selected).toBeDefined();
  expect(selected!.length).toBeLessThanOrEqual(10_240);
  expect(selected!.length).toBeLessThan(bigSelected.length);
  expect(value.payload.answers.token.other.length).toBeLessThanOrEqual(10_240);
  expect(value.payload.answers.token.other.length).toBeLessThan(bigOther.length);
  expect(value.meta?.redaction_count).toBe(2);
  expect(summary.counts.user_query_answer_truncated).toBe(2);
});

test("redactTrail strips answers when user_query_response cannot resolve its query", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "missing-query",
        answers: {
          token: { selected: ["secret"], other: "freeform secret" },
        },
      },
      source: {
        agent: "codex-cli",
        raw: {
          text: "freeform secret that does not match any configured pattern",
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const response = out[1]?.value as {
    meta?: { redaction_count?: number };
    payload: { answers: Record<string, unknown> };
    source: { raw: unknown };
  };
  expect(response.payload.answers).toEqual({});
  expect(response.source.raw).toEqual({
    redacted: "[STRIPPED unresolved user_query_response source.raw]",
  });
  expect(response.meta?.redaction_count).toBe(2);
  expect(summary.counts.user_query_response_unresolved_answers_stripped).toBe(1);
  expect(summary.counts.user_query_response_unresolved_source_raw_stripped).toBe(1);
});

test("redactTrail strips unresolved user_query_response source raw even when answers are empty", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "missing-query",
        answers: {},
      },
      source: {
        agent: "codex-cli",
        raw: {
          text: "raw response content that should not survive",
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const response = out[1]?.value as {
    meta?: { redaction_count?: number };
    payload: { answers: Record<string, unknown> };
    source: { raw: unknown };
  };
  expect(response.payload.answers).toEqual({});
  expect(response.source.raw).toEqual({
    redacted: "[STRIPPED unresolved user_query_response source.raw]",
  });
  expect(response.meta?.redaction_count).toBe(1);
  expect(summary.counts.user_query_response_unresolved_answers_stripped).toBeUndefined();
  expect(summary.counts.user_query_response_unresolved_source_raw_stripped).toBe(1);
});

test("redactTrail treats cross-session user_query_response references as unresolved", () => {
  const records: JsonlRecord[] = [
    header({ id: "01HSESS0000000000000000001" }),
    record(2, {
      type: "user_query",
      id: "query1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { questions: [{ id: "token", question: "Paste token" }] },
    }),
    header({ id: "01HSESS0000000000000000002" }),
    record(4, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "query1",
        answers: { token: { selected: ["secret"] } },
      },
      source: {
        agent: "codex-cli",
        raw: { text: "cross-session answer content" },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const response = out[3]?.value as {
    meta?: { redaction_count?: number };
    payload: { answers: Record<string, unknown> };
    source: { raw: unknown };
  };
  expect(response.payload.answers).toEqual({});
  expect(response.source.raw).toEqual({
    redacted: "[STRIPPED unresolved user_query_response source.raw]",
  });
  expect(response.meta?.redaction_count).toBe(2);
  expect(summary.counts.user_query_response_unresolved_answers_stripped).toBe(1);
  expect(summary.counts.user_query_response_unresolved_source_raw_stripped).toBe(1);
});

test("redactTrail strips unknown answer keys on resolved user_query_response", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query",
      id: "query1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { questions: [{ id: "safe", question: "Keep this?" }] },
    }),
    record(3, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "query1",
        answers: {
          safe: { selected: ["yes"] },
          token: { selected: ["secret"] },
        },
      },
      source: {
        agent: "codex-cli",
        raw: { text: "raw token answer content" },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const response = out[2]?.value as {
    meta?: { redaction_count?: number };
    payload: { answers: Record<string, unknown> };
    source: { raw: unknown };
  };
  expect(response.payload.answers).toEqual({ safe: { selected: ["yes"] } });
  expect(response.source.raw).toEqual({
    redacted: "[STRIPPED unresolved user_query_response source.raw]",
  });
  expect(response.meta?.redaction_count).toBe(2);
  expect(summary.counts.user_query_response_unknown_answers_stripped).toBe(1);
  expect(summary.counts.user_query_response_unknown_source_raw_stripped).toBe(1);
});

test("redactTrail does not recount already stripped unresolved user_query_response source raw", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "missing-query",
        answers: {},
      },
      source: {
        agent: "codex-cli",
        raw: { redacted: "[STRIPPED unresolved user_query_response source.raw]" },
      },
      meta: { redaction_count: 1 },
    }),
  ];

  const { records: out, summary } = redactTrail(records);
  const response = out[1]?.value as {
    meta?: { redaction_count?: number };
    source: { raw: unknown };
  };
  expect(response.source.raw).toEqual({
    redacted: "[STRIPPED unresolved user_query_response source.raw]",
  });
  expect(response.meta?.redaction_count).toBe(1);
  expect(summary.counts.user_query_response_unresolved_source_raw_stripped).toBeUndefined();
});

test("redactTrail redacts user_query strings and strips secret answers", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query",
      id: "query1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        questions: [
          {
            id: "token",
            question: "Paste token",
            is_secret: true,
            options: [{ label: "hunter2.special", description: "temporary token" }],
          },
          {
            id: "alice@example.com",
            question: "Contact alice@example.com?",
            options: [{ label: "alice@example.com" }],
          },
        ],
      },
    }),
    record(3, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "query1",
        answers: {
          token: { selected: ["hunter2.special"], other: "secret freeform" },
          "alice@example.com": { selected: ["alice@example.com"] },
        },
      },
      source: {
        raw: {
          block: {
            content:
              'User has answered your questions: "Paste token"="secret freeform". You can now continue...',
          },
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    userSecrets: ["hunter2.special"],
  });

  const query = out[1]?.value as {
    payload: {
      questions: Array<{
        question: string;
        options: Array<{ label: string; description?: string }>;
      }>;
    };
  };
  const response = out[2]?.value as {
    meta?: { redaction_count?: number };
    payload: {
      answers: {
        token: { selected: string[]; other?: string };
        "[EMAIL]": { selected: string[] };
      };
    };
    source: { raw: unknown };
  };
  expect(query.payload.questions[0]?.options[0]?.label).toBe("[USER_SECRET]");
  expect(query.payload.questions[1]?.question).toBe("Contact [EMAIL]?");
  expect(query.payload.questions[1]?.options[0]?.label).toBe("[EMAIL]");
  expect(response.payload.answers.token).toEqual({ selected: [] });
  expect(response.payload.answers["[EMAIL]"]).toEqual({ selected: ["[EMAIL]"] });
  expect(response.payload.answers).not.toHaveProperty("alice@example.com");
  expect(JSON.stringify(response.source.raw)).not.toContain("secret freeform");
  expect(response.source.raw).toEqual({
    redacted: "[STRIPPED secret user_query_response source.raw]",
  });
  expect(summary.counts.user_secret).toBe(1);
  expect(summary.counts.email_pii).toBeGreaterThanOrEqual(2);
  expect(summary.counts.user_query_secret_answer).toBe(1);
  expect(summary.counts.user_query_secret_source_raw).toBe(1);
  expect(response.meta?.redaction_count).toBe(3);
});

test("redactTrail does not recount already stripped user_query_response source raw", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query",
      id: "query1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        questions: [{ id: "token", question: "Paste token", is_secret: true }],
      },
    }),
    record(3, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "query1",
        answers: { token: { selected: [] } },
      },
      source: {
        raw: { redacted: "[STRIPPED secret user_query_response source.raw]" },
      },
    }),
  ];

  const { summary } = redactTrail(records);

  expect(summary.counts.user_query_secret_source_raw).toBeUndefined();
  expect(summary.counts.user_query_secret_answer).toBeUndefined();
});

test("redactTrail replaces partially stripped user_query_response source raw", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query",
      id: "query1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        questions: [{ id: "token", question: "Paste token", is_secret: true }],
      },
    }),
    record(3, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "query1",
        answers: { token: { selected: [] } },
      },
      source: {
        raw: {
          redacted: "[STRIPPED secret user_query_response source.raw]",
          original: "secret freeform",
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);
  const response = out[2]?.value as { source: { raw: unknown } };

  expect(response.source.raw).toEqual({
    redacted: "[STRIPPED secret user_query_response source.raw]",
  });
  expect(JSON.stringify(response.source.raw)).not.toContain("secret freeform");
  expect(summary.counts.user_query_secret_source_raw).toBe(1);
});

test("redactTrail rewrites user_query_response answer keys into a null-prototype object", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query",
      id: "query1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        questions: [
          { id: "__proto__", question: "Prototype?" },
          { id: "alice@example.com", question: "Contact alice@example.com?" },
        ],
      },
    }),
    record(3, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "query1",
        answers: {
          ["__proto__"]: { selected: ["yes"] },
          "alice@example.com": { selected: ["alice@example.com"] },
        },
      },
    }),
  ];

  const { records: out } = redactTrail(records);
  const response = out[2]?.value as {
    payload: { answers: Record<string, { selected: string[] }> };
  };
  const answers = response.payload.answers;

  expect(Object.getPrototypeOf(answers)).toBe(null);
  expect(Object.hasOwn(answers, "__proto__")).toBe(true);
  expect(answers.__proto__).toEqual({ selected: ["yes"] });
  expect(answers["[EMAIL]"]).toEqual({ selected: ["[EMAIL]"] });
});

test("redactTrail keeps redacted user_query question ids unique", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_query",
      id: "query1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        questions: [
          { id: "[EMAIL]", question: "Existing sanitized id?" },
          { id: "alice@example.com", question: "Contact alice@example.com?" },
        ],
      },
    }),
    record(3, {
      type: "user_query_response",
      id: "response1",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "query1",
        answers: {
          "[EMAIL]": { selected: ["yes"] },
          "alice@example.com": { selected: ["alice@example.com"] },
        },
      },
    }),
  ];

  const { records: out } = redactTrail(records);
  const query = out[1]?.value as { payload: { questions: Array<{ id: string }> } };
  const response = out[2]?.value as {
    payload: { answers: Record<string, { selected: string[] }> };
  };

  expect(query.payload.questions.map((question) => question.id)).toEqual(["[EMAIL]", "[EMAIL]_2"]);
  expect(response.payload.answers["[EMAIL]"]).toEqual({ selected: ["yes"] });
  expect(response.payload.answers["[EMAIL]_2"]).toEqual({ selected: ["[EMAIL]"] });
  expect(response.payload.answers).not.toHaveProperty("alice@example.com");
});

test("redactTrail keeps entropy-redacted user_query ids aligned with answer keys", async () => {
  const tokenId = "zQ9mK2pL8vR4sT7xY1aB3cD5eF6gH7jK";
  const records: JsonlRecord[] = [
    record(1, {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
      ts: "2026-05-22T00:00:00.000Z",
      agent: { name: "codex-cli" },
    }),
    record(2, {
      type: "user_query",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        questions: [{ id: tokenId, question: "Pick one?" }],
      },
    }),
    record(3, {
      type: "user_query_response",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "01HEVTA0000000000000000001",
        answers: {
          [tokenId]: { selected: ["yes"] },
        },
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { enableEntropyRedaction: true });
  const query = out[1]?.value as { payload: { questions: Array<{ id: string }> } };
  const response = out[2]?.value as {
    payload: { answers: Record<string, { selected: string[] }> };
  };

  expect(query.payload.questions[0]?.id).toBe("[HIGH_ENTROPY_SECRET]");
  expect(response.payload.answers["[HIGH_ENTROPY_SECRET]"]).toEqual({ selected: ["yes"] });
  expect(response.payload.answers).not.toHaveProperty(tokenId);
  expect(summary.counts.high_entropy_token).toBe(2);

  const jsonl = `${out.map((r) => JSON.stringify(r.value)).join("\n")}\n`;
  const diagnostics = await validateTrailString(jsonl);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("redactTrail output_size uses original output bytes before secret redaction", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const originalOutput = `${key}\n${"X".repeat(20_000)}`;
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_result",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        for_id: "evtcall",
        ok: true,
        output: originalOutput,
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    meta?: { redaction_count?: number };
    payload: { output: string; output_size?: number; truncated?: boolean };
  };
  expect(value.payload.output).not.toContain(key);
  expect(value.payload.truncated).toBe(true);
  expect(value.payload.output_size).toBe(new TextEncoder().encode(originalOutput).byteLength);
  expect(value.meta?.redaction_count).toBe(2);
  expect(summary.counts.openai_api_key).toBe(1);
  expect(summary.counts.output_truncated).toBe(1);
});

test("redactTrail repairs missing output_size on already-truncated output below maxBytes", () => {
  const originalOutput = "short redacted output";
  const records: JsonlRecord[] = [
    header({ content_hash: "a".repeat(64) }),
    record(2, {
      type: "tool_result",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        for_id: "evtcall",
        ok: true,
        output: originalOutput,
        truncated: true,
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as { content_hash?: string };
  const value = out[1]?.value as {
    meta?: { redaction_count?: number };
    payload: { output_size?: number; truncated?: boolean };
  };
  expect(headerValue.content_hash).toBe("<pending>");
  expect(value.payload.truncated).toBe(true);
  expect(value.payload.output_size).toBe(new TextEncoder().encode(originalOutput).byteLength);
  expect(value.meta?.redaction_count).toBe(1);
  expect(summary.counts.output_size_repaired).toBe(1);
});

test("redactTrail preserves existing output_size and sums multiple mutations on one entry", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_result",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        for_id: "evtcall",
        ok: true,
        output: `${key}\n${"X".repeat(20_000)}`,
        truncated: true,
        output_size: 50_000,
      },
      meta: { redaction_count: 5 },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    meta: { redaction_count: number };
    payload: {
      output: string;
      output_size: number;
    };
  };
  expect(value.payload.output).not.toContain(key);
  expect(value.payload.output.length).toBeLessThan(20_000);
  expect(value.payload.output_size).toBe(50_000);
  expect(value.meta.redaction_count).toBe(7);
  expect(summary.counts.openai_api_key).toBe(1);
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

test("redactTrail preserves existing redaction_count and adds new entry mutations", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "already clean" },
      meta: { redaction_count: 7 },
    }),
    record(3, {
      type: "agent_message",
      id: "evt2",
      ts: "2026-05-22T00:00:02.000Z",
      payload: { text: `secret ${key}` },
      meta: { redaction_count: 2 },
    }),
  ];

  const { records: out } = redactTrail(records);

  expect((out[1]?.value as { meta: { redaction_count: number } }).meta.redaction_count).toBe(7);
  expect((out[2]?.value as { meta: { redaction_count: number } }).meta.redaction_count).toBe(3);
});

test("redactTrail ignores invalid existing redaction_count when adding new entry mutations", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: `secret ${key}` },
      meta: { redaction_count: -1 },
    }),
  ];

  const { records: out } = redactTrail(records);

  expect((out[1]?.value as { meta: { redaction_count: number } }).meta.redaction_count).toBe(1);
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

test("redactTrail preserves schema-valid tool_call overflow references", async () => {
  const overflowRef = `sha256:${"a".repeat(64)}`;
  const records: JsonlRecord[] = [
    header({ id: "01HSESS0000000000000000001" }),
    record(2, {
      type: "tool_call",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        tool: "shell_command",
        args: { command: "curl example.com" },
        truncated: true,
        args_size: 42,
        overflow_ref: overflowRef,
      },
    }),
    record(3, {
      type: "tool_result",
      id: "01HEVTA0000000000000000002",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "01HEVTA0000000000000000001",
        ok: true,
      },
    }),
  ];

  const { records: out } = redactTrail(records, {
    userSecrets: ["secret-overflow-token"],
  });

  const call = out[1]?.value as { payload: { overflow_ref: string } };
  expect(call.payload.overflow_ref).toBe(overflowRef);
  expect(await validateTrailString(out.map((item) => item.raw).join("\n"))).toEqual([]);
});

test("redactTrail preserves schema-valid tool_result overflow references", async () => {
  const overflowRef = `sha256:${"b".repeat(64)}`;
  const records: JsonlRecord[] = [
    header({ id: "01HSESS0000000000000000001" }),
    record(2, {
      type: "tool_result",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        ok: true,
        truncated: true,
        output_size: 42,
        overflow_ref: overflowRef,
      },
    }),
  ];

  const { records: out } = redactTrail(records, {
    userSecrets: ["secret-overflow-token"],
  });

  const result = out[1]?.value as { payload: { overflow_ref: string } };
  expect(result.payload.overflow_ref).toBe(overflowRef);
  expect(await validateTrailString(out.map((item) => item.raw).join("\n"))).toEqual([]);
});

test("redactTrail redacts secrets in tool_result.payload.meta structured outputs", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "tool_result",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        for_id: "call1",
        ok: true,
        output: "[serialized]",
        meta: {
          shell_command: { stdout: `printed ${key}`, stderr: "", exit_code: 0 },
          mcp_call: {
            content_blocks: [
              { type: "text", text: `block ${key}` },
              { type: "image", data: `imgdata ${key}` },
            ],
          },
        },
      },
    }),
  ];

  const { records: out } = redactTrail(records);

  const result = out[1]?.value as {
    payload: {
      meta: {
        shell_command: { stdout: string };
        mcp_call: { content_blocks: Array<{ text?: string; data?: string }> };
      };
    };
  };
  expect(result.payload.meta.shell_command.stdout).toContain("[OPENAI_KEY]");
  expect(result.payload.meta.shell_command.stdout).not.toContain(key);
  expect(result.payload.meta.mcp_call.content_blocks[0]?.text).toContain("[OPENAI_KEY]");
  expect(result.payload.meta.mcp_call.content_blocks[0]?.text).not.toContain(key);
  expect(result.payload.meta.mcp_call.content_blocks[1]?.data).toContain("[OPENAI_KEY]");
  expect(result.payload.meta.mcp_call.content_blocks[1]?.data).not.toContain(key);
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
      payload: { attachments: Array<{ kind: string; uri?: string; name?: string }> };
    }
  ).payload.attachments[0]?.uri;
  const attachment = (
    out[4]?.value as {
      payload: { attachments: Array<{ kind: string; uri?: string; name?: string }> };
    }
  ).payload.attachments[0];
  expect(uri).toBeUndefined();
  expect(attachment).toEqual({ kind: "file", name: "secret.txt" });
  expect(summary.counts.openai_api_key).toBe(3);
  expect(summary.counts.attachment_file_uri_removed).toBe(1);
});

test("redactTrail redacts secrets in agent_message.attachments and tool_result.attachments", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "here is the chart",
        attachments: [{ kind: "image", uri: `file:///Users/alice/${key}.png`, name: "chart.png" }],
      },
    }),
    record(3, {
      type: "tool_result",
      id: "evt2",
      ts: "2026-05-22T00:00:02.000Z",
      payload: {
        for_id: "evt1",
        ok: true,
        output: "captured screenshot",
        attachments: [{ kind: "image", uri: `file:///Users/alice/${key}.png` }],
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const agentAttachment = (
    out[1]?.value as {
      payload: { attachments: Array<{ kind: string; uri?: string; name?: string }> };
    }
  ).payload.attachments[0];
  expect(agentAttachment).toEqual({ kind: "image", name: "chart.png" });

  const toolAttachment = (
    out[2]?.value as { payload: { attachments: Array<{ kind: string; uri?: string }> } }
  ).payload.attachments[0];
  expect(toolAttachment).toEqual({ kind: "image" });

  expect(summary.counts.openai_api_key).toBeUndefined();
  expect(summary.counts.attachment_file_uri_removed).toBe(2);
});

test("redactTrail rewrites file attachment uris to transported sha256 refs", () => {
  const fileUri = "file:///Users/alice/chart.png";
  const shaRef = `sha256:${"a".repeat(64)}` as const;
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "see attached",
        attachments: [{ kind: "image", uri: fileUri, media_type: "image/png", name: "chart.png" }],
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, {
    attachmentUriRewrites: { [fileUri]: shaRef },
  });

  const attachment = (
    out[1]?.value as {
      payload: {
        attachments: Array<{ kind: string; uri?: string; media_type?: string; name?: string }>;
      };
    }
  ).payload.attachments[0];
  expect(attachment).toEqual({
    kind: "image",
    uri: shaRef,
    media_type: "image/png",
    name: "chart.png",
  });
  expect(summary.counts.attachment_file_uri_rewritten).toBe(1);
});

test("redactTrail redacts secrets in name-only attachments", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "see attachment",
        attachments: [{ kind: "file", name: "secret-alpha.txt" }],
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { userSecrets: ["secret-alpha"] });

  const name = (out[1]?.value as { payload: { attachments: Array<{ name: string }> } }).payload
    .attachments[0]?.name;
  expect(name).toBe("[USER_SECRET].txt");
  expect(summary.counts.user_secret).toBe(1);
});

test("redactTrail removes mixed-case file attachment uris", () => {
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        text: "see attached",
        attachments: [{ kind: "file", uri: "FILE:///Users/alice/secret.txt", name: "secret.txt" }],
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const attachment = (
    out[1]?.value as {
      payload: { attachments: Array<{ kind: string; uri?: string; name?: string }> };
    }
  ).payload.attachments[0];
  expect(attachment).toEqual({ kind: "file", name: "secret.txt" });
  expect(summary.counts.attachment_file_uri_removed).toBe(1);
});

test("redactTrail redacts quarantined source drift while preserving raw shape", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "system_event",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        kind: "x-codex/unknown_record",
        data: {
          raw: {
            type: "future_record",
            nested: { token: key },
            parts: ["safe", `Bearer ${"A".repeat(32)}`],
          },
        },
      },
      source: {
        agent: "codex-cli",
        original_type: "future_record",
        synthesized: true,
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    payload: { data: { raw: { type: string; nested: { token: string }; parts: string[] } } };
  };
  expect(value.payload.data.raw).toEqual({
    type: "future_record",
    nested: { token: "[OPENAI_KEY]" },
    parts: ["safe", "Bearer [TOKEN]"],
  });
  expect(JSON.stringify(value)).not.toContain(key);
  expect(summary.counts.openai_api_key).toBe(1);
  expect(summary.counts.bearer_token).toBe(1);
});

test("redactTrail walks record.value.meta on both header and entries", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header({ meta: { "x-example/token": key } }),
    record(2, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: "hi" },
      meta: { "x-example/nested": { token: key } },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const headerValue = out[0]?.value as { meta: { "x-example/token": string } };
  expect(headerValue.meta["x-example/token"]).toBe("[OPENAI_KEY]");
  const entryValue = out[1]?.value as { meta: { "x-example/nested": { token: string } } };
  expect(entryValue.meta["x-example/nested"].token).toBe("[OPENAI_KEY]");
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

test("redactTrail resets content_hash to <pending> on every session header and the envelope in a multi-session file", () => {
  const stamped = "a".repeat(64);
  const envStamped = "b".repeat(64);
  const records: JsonlRecord[] = [
    record(1, {
      type: "trail",
      schema_version: "0.1.0",
      id: "trl1",
      ts: "2026-05-17T14:00:00.000Z",
      producer: "trail-cli/0.3.0",
      content_hash: envStamped,
    }),
    record(2, {
      type: "session",
      schema_version: "0.1.0",
      id: "sess1",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
      content_hash: stamped,
    }),
    record(3, {
      type: "agent_message",
      id: "evt1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: {
        text: "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789",
      },
    }),
    record(4, {
      type: "session",
      schema_version: "0.1.0",
      id: "sess2",
      ts: "2026-05-17T14:05:00.000Z",
      agent: { name: "claude-code" },
      content_hash: stamped,
    }),
    record(5, {
      type: "user_message",
      id: "evt2",
      ts: "2026-05-17T14:05:01.000Z",
      payload: { text: "ok" },
    }),
  ];

  const { records: out } = redactTrail(records);

  expect((out[0]?.value as { content_hash: string }).content_hash).toBe("<pending>");
  expect((out[1]?.value as { content_hash: string }).content_hash).toBe("<pending>");
  expect((out[3]?.value as { content_hash: string }).content_hash).toBe("<pending>");
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

test("redactTrail walks capability_change payload metadata", () => {
  const key = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header(),
    record(2, {
      type: "capability_change",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: {
        scope: "tool",
        reason: "registered",
        added: [{ name: "dynamic_tool", metadata: { description: `uses ${key}` } }],
        changed: [{ name: "dynamic_tool", field: "instructions", to: key }],
      },
    }),
  ];

  const { records: out, summary } = redactTrail(records);

  const value = out[1]?.value as {
    payload: {
      added: Array<{ metadata: { description: string } }>;
      changed: Array<{ to: string }>;
    };
  };
  expect(value.payload.added[0]?.metadata.description).toContain("[OPENAI_KEY]");
  expect(value.payload.changed[0]?.to).toBe("[OPENAI_KEY]");
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

test("redactTrail preserves header content_hash when only allowed secrets are skipped", () => {
  const finalized = "a".repeat(64);
  const allowed = "sk-proj-AbCdEfGhIjKlMnOpQrStUv0123456789-_AbCdEfGhIjKlMnOpQrStUv0123456789";
  const records: JsonlRecord[] = [
    header({ content_hash: finalized }),
    record(2, {
      type: "user_message",
      id: "evt1",
      ts: "2026-05-22T00:00:01.000Z",
      payload: { text: allowed },
    }),
  ];

  const { records: out, summary } = redactTrail(records, { allowedSecrets: [allowed] });

  const headerValue = out[0]?.value as { content_hash: string };
  const messageValue = out[1]?.value as { payload: { text: string }; meta?: unknown };
  expect(headerValue.content_hash).toBe(finalized);
  expect(messageValue.payload.text).toBe(allowed);
  expect(messageValue.meta).toBeUndefined();
  expect(summary.counts).toEqual({ allowlisted_skip: 1 });
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
