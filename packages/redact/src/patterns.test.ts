import { expect, test } from "bun:test";
import type { JsonlRecord } from "@agent-trail/core";
import { redactTrail } from "./redactor.ts";

function header(): JsonlRecord {
  const value = {
    type: "session",
    schema_version: "0.1.0",
    id: "sess1",
    ts: "2026-05-22T00:00:00.000Z",
    agent: { name: "codex-cli" },
  };
  return { line: 1, raw: JSON.stringify(value), value };
}

function agentMessage(text: string): JsonlRecord {
  const value = {
    type: "agent_message",
    id: "evt1",
    ts: "2026-05-22T00:00:01.000Z",
    payload: { text },
  };
  return { line: 2, raw: JSON.stringify(value), value };
}

type Case = {
  patternId: string;
  sample: string;
  placeholderContains: string;
};

const CASES: Case[] = [
  {
    patternId: "aws_access_key",
    sample: "key=AKIAIOSFODNN7EXAMPLE here",
    placeholderContains: "[AWS_ACCESS_KEY]",
  },
  {
    patternId: "anthropic_api_key",
    sample: "ANTHROPIC=sk-ant-api01-AbCdEfGhIjKlMnOpQrStUv0123456789",
    placeholderContains: "[ANTHROPIC_KEY]",
  },
  {
    patternId: "github_pat",
    sample: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 found",
    placeholderContains: "[GITHUB_PAT]",
  },
  {
    patternId: "github_oauth",
    sample: "token gho_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    placeholderContains: "[GITHUB_OAUTH]",
  },
  {
    patternId: "stripe_api_key",
    sample: `Stripe ${["sk", "live", "AbCdEfGhIjKlMnOpQrStUvWxYz"].join("_")}`,
    placeholderContains: "[STRIPE_KEY]",
  },
  {
    patternId: "slack_token",
    sample: `slack ${["xoxb", "1234567890", "1234567890123", "AbCdEfGhIjKlMnOpQrSt"].join("-")}`,
    placeholderContains: "[SLACK_TOKEN]",
  },
  {
    patternId: "slack_webhook",
    sample:
      "post to https://hooks.slack.com/services/T0AAA111/B0BBB222/aBcDeFgHiJkLmNoPqRsTuVwX please",
    placeholderContains: "[SLACK_WEBHOOK]",
  },
  {
    patternId: "google_api_key",
    sample: "google AIzaSyD-AbCdEfGhIjKlMnOpQrStUvWxYz01234",
    placeholderContains: "[GOOGLE_API_KEY]",
  },
  {
    patternId: "jwt_token",
    sample:
      "Authorization eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U end",
    placeholderContains: "[JWT]",
  },
  {
    patternId: "ssh_private_key",
    sample:
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFh\n-----END RSA PRIVATE KEY-----",
    placeholderContains: "[SSH_PRIVATE_KEY]",
  },
  {
    patternId: "env_assignment",
    sample: "DATABASE_PASSWORD=hunter2.secret.value.123",
    placeholderContains: "[ENV_SECRET]",
  },
  {
    patternId: "bearer_token",
    sample: "Authorization: Bearer abcdefABCDEF0123456789xyzXYZ",
    placeholderContains: "Bearer [TOKEN]",
  },
];

for (const c of CASES) {
  test(`curated pattern '${c.patternId}' matches and replaces a sample`, () => {
    const records = [header(), agentMessage(c.sample)];
    const { records: out, summary } = redactTrail(records);
    const value = out[1]?.value as { payload: { text: string } };
    expect(value.payload.text).toContain(c.placeholderContains);
    expect(summary.counts[c.patternId]).toBeGreaterThanOrEqual(1);
  });
}
