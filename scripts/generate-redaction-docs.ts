import { readFile } from "node:fs/promises";
import { DEFAULT_PATTERNS } from "../packages/core/src/index.ts";

const DOC_PATH = "docs/redaction-patterns.md";

const EXAMPLES: Record<string, string> = {
  anthropic_api_key: "sk-ant-api01-<long secret body>",
  openai_api_key: "sk-proj-<long secret body>",
  aws_access_key: "AKIA<16 uppercase alphanumeric characters>",
  github_pat: "ghp_<36 alphanumeric characters>",
  github_oauth: "gho_<36 alphanumeric characters>",
  stripe_api_key: "sk_live_<24+ alphanumeric characters>",
  slack_token: "xoxb-<team>-<bot>-<secret>",
  slack_webhook: "https://hooks.slack.com/services/<team>/<channel>/<secret>",
  npm_token: "npm_<long token body>",
  pypi_token: "pypi-<long token body>",
  datadog_api_key: "DD_API_KEY=<32 hex characters>",
  sentry_dsn: "SENTRY_DSN=https://<public>@o123.ingest.sentry.io/456",
  twilio_auth_token: "TWILIO_AUTH_TOKEN=<32 hex characters>",
  sendgrid_api_key: "SG.<segment>.<secret>",
  cloudflare_api_token: "CLOUDFLARE_API_TOKEN=<long token body>",
  vercel_token: "VERCEL_TOKEN=<long token body>",
  heroku_api_key: "HEROKU_API_KEY=<uuid-like token>",
  twitter_bearer_token: "TWITTER_BEARER_TOKEN=<84+ character bearer token>",
  discord_webhook: "https://discord.com/api/webhooks/<id>/<secret>",
  firebase_key: "FIREBASE_API_KEY=AIza<firebase key body>",
  google_api_key: "AIza<google api key body>",
  algolia_api_key: "ALGOLIA_API_KEY=<32 hex characters>",
  mongodb_atlas_uri: "mongodb+srv://user:<password>@cluster.example.net/app",
  database_url: "DATABASE_URL=postgres://user:<password>@db.example/app",
  bitbucket_app_password: "BITBUCKET_APP_PASSWORD=<long token body>",
  gcp_service_account_private_key:
    '"private_key":"-----BEGIN PRIVATE KEY-----\\n<key body>\\n-----END PRIVATE KEY-----\\n"',
  env_assignment: "DATABASE_PASSWORD=<secret value>",
  json_credential_field: '"password":"<secret value>"',
  credentialed_uri: "postgres://user:<password>@db.example:5432/app",
  dsn_password: "Password=<secret>;",
  gitlab_pat: "glpat-<20+ character token>",
  azure_sas: "https://acct.blob.core.windows.net/container/blob.txt?sv=<version>&sig=<signature>",
  jwt_token: "<jwt header>.<jwt payload>.<jwt signature>",
  ssh_private_key: "-----BEGIN RSA PRIVATE KEY-----\\n<key body>\\n-----END RSA PRIVATE KEY-----",
  bearer_token: "Bearer <long token body>",
  home_path: "/Users/alice/projects/agent-trail",
  home_path_windows: "C:\\Users\\alice\\notes.md",
};

const missing = DEFAULT_PATTERNS.filter((pattern) => EXAMPLES[pattern.id] === undefined);
if (missing.length > 0) {
  throw new Error(`missing redaction docs examples: ${missing.map((p) => p.id).join(", ")}`);
}

const content = [
  "# Redaction Patterns",
  "",
  "Generated from `DEFAULT_PATTERNS` by `bun run generate:redaction-docs`.",
  "",
  "## Built-In Detectors",
  "",
  "| Pattern id | Description | Example shape | Placeholder | Source |",
  "|---|---|---|---|---|",
  ...DEFAULT_PATTERNS.map(
    (pattern) =>
      `| ${cell(pattern.id)} | ${cell(pattern.description)} | ${cell(EXAMPLES[pattern.id] ?? "")} | ${cell(pattern.placeholder)} | built-in |`,
  ),
  "",
  "## Rule Pack Schema",
  "",
  "Custom rule packs load from `.trail/redactors/**/*.{yaml,yml,json}` and `~/.config/trail/redactors/**/*.{yaml,yml,json}`.",
  "",
  "```yaml",
  "name: acme",
  "version: 1",
  "description: ACME internal tokens",
  "allowlist:",
  "  - ACME-PUBLIC-SAMPLE",
  "rules:",
  "  - id: acme_internal_token",
  "    description: ACME internal service token",
  "    regex: 'ACME-[A-Z0-9]{32}'",
  "    placeholder: '[ACME_TOKEN]'",
  "    samples:",
  "      - input: 'ACME-ABCDEF0123456789ABCDEF0123456789'",
  "        redacted: true",
  "      - input: 'ACME-too-short'",
  "        redacted: false",
  "```",
  "",
  "Pack invariants: `name` matches the filename stem, `version` is numeric, rule ids are unique within a pack, and rule ids match `[A-Za-z0-9._-]` with max length 64.",
  "",
  "Pack load caps: max 1 MiB per file, max 256 files total, recursive subdirectories allowed, symlinks skipped, malformed packs warn and continue.",
  "",
  "## Settings Schema",
  "",
  "Redaction settings load from `.trail/settings.json` and `~/.config/trail/settings.json`. Project settings load first, then user-global settings, then CLI flags. Array fields merge and dedupe; scalar PII toggles from later settings override earlier settings.",
  "",
  "```json",
  "{",
  '  "redaction": {',
  '    "allowedSecrets": ["literal-safe-value"],',
  '    "pii": {',
  '      "email": true,',
  '      "phone": true,',
  '      "ssn": true,',
  '      "credit_card": true,',
  '      "name": true,',
  '      "emailAllowlist": ["*@project.example"],',
  '      "customLabels": {',
  '        "employee_id": "EMP-\\\\d{6}"',
  "      }",
  "    }",
  "  }",
  "}",
  "```",
  "",
  "## PII Retention Note",
  "",
  "`@redactpii/node` remains in use for non-phone PII because it provides configurable EMAIL, SSN, CREDIT_CARD, and NAME detection. Agent Trail disables its PHONE rule and uses a guarded phone detector to avoid IP/version false positives observed during #192.",
  "",
].join("\n");

if (Bun.argv.includes("--check")) {
  const existing = await readFile(DOC_PATH, "utf8").catch(() => "");
  if (existing !== content) {
    throw new Error(`${DOC_PATH} is stale; run bun run generate:redaction-docs`);
  }
} else {
  await Bun.write(DOC_PATH, content);
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
