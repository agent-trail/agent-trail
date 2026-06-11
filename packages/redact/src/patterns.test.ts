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
  {
    patternId: "npm_token",
    sample: "npm token npm_abcdefghijklmnopqrstuvwxyz0123456789",
    placeholderContains: "[NPM_TOKEN]",
  },
  {
    patternId: "pypi_token",
    sample: `pypi ${"pypi-".concat("A".repeat(48))}`,
    placeholderContains: "[PYPI_TOKEN]",
  },
  {
    patternId: "datadog_api_key",
    sample: "DD_API_KEY=0123456789abcdef0123456789abcdef",
    placeholderContains: "[DATADOG_KEY]",
  },
  {
    patternId: "sentry_dsn",
    sample: "SENTRY_DSN=https://0123456789abcdef0123456789abcdef@o123.ingest.sentry.io/456",
    placeholderContains: "[SENTRY_DSN]",
  },
  {
    patternId: "twilio_auth_token",
    sample: "TWILIO_AUTH_TOKEN=0123456789abcdef0123456789abcdef",
    placeholderContains: "[TWILIO_TOKEN]",
  },
  {
    patternId: "sendgrid_api_key",
    sample: `sendgrid SG.${"A".repeat(22)}.${"B".repeat(43)}`,
    placeholderContains: "[SENDGRID_KEY]",
  },
  {
    patternId: "cloudflare_api_token",
    sample: "CLOUDFLARE_API_TOKEN=abcdefghijklmnopqrstuvwxyz0123456789_-",
    placeholderContains: "[CLOUDFLARE_TOKEN]",
  },
  {
    patternId: "vercel_token",
    sample: "VERCEL_TOKEN=abcdefghijklmnopqrstuvwxyz0123456789",
    placeholderContains: "[VERCEL_TOKEN]",
  },
  {
    patternId: "heroku_api_key",
    sample: "HEROKU_API_KEY=01234567-89ab-cdef-0123-456789abcdef",
    placeholderContains: "[HEROKU_KEY]",
  },
  {
    patternId: "twitter_bearer_token",
    sample: `TWITTER_BEARER_TOKEN=${"A".repeat(84)}`,
    placeholderContains: "[TWITTER_TOKEN]",
  },
  {
    patternId: "discord_webhook",
    sample:
      "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
    placeholderContains: "[DISCORD_WEBHOOK]",
  },
  {
    patternId: "firebase_key",
    sample: "FIREBASE_API_KEY=AIzaSyD-AbCdEfGhIjKlMnOpQrStUvWxYz01234",
    placeholderContains: "[FIREBASE_KEY]",
  },
  {
    patternId: "algolia_api_key",
    sample: "ALGOLIA_API_KEY=0123456789abcdef0123456789abcdef",
    placeholderContains: "[ALGOLIA_KEY]",
  },
  {
    patternId: "mongodb_atlas_uri",
    sample: "mongodb+srv://app:secret-pass-123@cluster0.abcd1.mongodb.net/app",
    placeholderContains: "[MONGODB_ATLAS_URI]",
  },
  {
    patternId: "gitlab_pat",
    sample: "glpat-abcdefghijklmnopqrstuvwxyz012345",
    placeholderContains: "[GITLAB_PAT]",
  },
  {
    patternId: "bitbucket_app_password",
    sample: "BITBUCKET_APP_PASSWORD=abcdefghijklmnopqrstuvwxyz0123456789",
    placeholderContains: "[BITBUCKET_APP_PASSWORD]",
  },
  {
    patternId: "azure_sas",
    sample:
      "https://acct.blob.core.windows.net/container/blob.txt?sv=2024-11-04&sig=abcdefghijklmnopqrstuvwxyz0123456789%2Babcdef",
    placeholderContains: "sig=[AZURE_SAS_SIGNATURE]",
  },
  {
    patternId: "gcp_service_account_private_key",
    sample:
      '"private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\\n-----END PRIVATE KEY-----\\n"',
    placeholderContains: "[GCP_PRIVATE_KEY]",
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
