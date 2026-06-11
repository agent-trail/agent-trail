# Redaction Patterns

Generated from `DEFAULT_PATTERNS` by `bun run generate:redaction-docs`.

## Built-In Detectors

| Pattern id | Description | Example shape | Placeholder | Source |
|---|---|---|---|---|
| anthropic_api_key | Anthropic API key | sk-ant-api01-<long secret body> | [ANTHROPIC_KEY] | built-in |
| openai_api_key | OpenAI API key | sk-proj-<long secret body> | [OPENAI_KEY] | built-in |
| aws_access_key | AWS access key ID | AKIA<16 uppercase alphanumeric characters> | [AWS_ACCESS_KEY] | built-in |
| github_pat | GitHub personal access token | ghp_<36 alphanumeric characters> | [GITHUB_PAT] | built-in |
| github_oauth | GitHub OAuth token | gho_<36 alphanumeric characters> | [GITHUB_OAUTH] | built-in |
| stripe_api_key | Stripe API key | sk_live_<24+ alphanumeric characters> | [STRIPE_KEY] | built-in |
| slack_token | Slack token | xoxb-<team>-<bot>-<secret> | [SLACK_TOKEN] | built-in |
| slack_webhook | Slack incoming webhook URL | https://hooks.slack.com/services/<team>/<channel>/<secret> | https://[SLACK_WEBHOOK] | built-in |
| npm_token | npm access token | npm_<long token body> | [NPM_TOKEN] | built-in |
| pypi_token | PyPI API token | pypi-<long token body> | [PYPI_TOKEN] | built-in |
| datadog_api_key | Datadog API key assignment | DD_API_KEY=<32 hex characters> | $1=[DATADOG_KEY] | built-in |
| sentry_dsn | Sentry DSN | SENTRY_DSN=https://<public>@o123.ingest.sentry.io/456 | $1https://[SENTRY_DSN] | built-in |
| twilio_auth_token | Twilio auth token assignment | TWILIO_AUTH_TOKEN=<32 hex characters> | $1=[TWILIO_TOKEN] | built-in |
| sendgrid_api_key | SendGrid API key | SG.<segment>.<secret> | [SENDGRID_KEY] | built-in |
| cloudflare_api_token | Cloudflare API token assignment | CLOUDFLARE_API_TOKEN=<long token body> | $1=[CLOUDFLARE_TOKEN] | built-in |
| vercel_token | Vercel token assignment | VERCEL_TOKEN=<long token body> | $1=[VERCEL_TOKEN] | built-in |
| heroku_api_key | Heroku API key assignment | HEROKU_API_KEY=<uuid-like token> | $1=[HEROKU_KEY] | built-in |
| twitter_bearer_token | Twitter/X bearer token assignment | TWITTER_BEARER_TOKEN=<84+ character bearer token> | $1=[TWITTER_TOKEN] | built-in |
| discord_webhook | Discord webhook URL | https://discord.com/api/webhooks/<id>/<secret> | https://[DISCORD_WEBHOOK] | built-in |
| firebase_key | Firebase API key assignment | FIREBASE_API_KEY=AIza<firebase key body> | $1=[FIREBASE_KEY] | built-in |
| google_api_key | Google API key | AIza<google api key body> | [GOOGLE_API_KEY] | built-in |
| algolia_api_key | Algolia API key assignment | ALGOLIA_API_KEY=<32 hex characters> | $1=[ALGOLIA_KEY] | built-in |
| mongodb_atlas_uri | MongoDB Atlas URI with embedded credentials | mongodb+srv://user:<password>@cluster.example.net/app | [MONGODB_ATLAS_URI] | built-in |
| database_url | DATABASE_URL with embedded password | DATABASE_URL=postgres://user:<password>@db.example/app | $1[DATABASE_URL_PASSWORD]$2 | built-in |
| bitbucket_app_password | Bitbucket app password assignment | BITBUCKET_APP_PASSWORD=<long token body> | $1=[BITBUCKET_APP_PASSWORD] | built-in |
| gcp_service_account_private_key | GCP service account private_key JSON field | "private_key":"-----BEGIN PRIVATE KEY-----\n<key body>\n-----END PRIVATE KEY-----\n" | $1[GCP_PRIVATE_KEY]$2 | built-in |
| env_assignment | ENV-style NAME=VALUE assignment with credential-looking value | DATABASE_PASSWORD=<secret value> | $1=[ENV_SECRET] | built-in |
| json_credential_field | JSON string field with credential-looking key | "password":"<secret value>" | "$1":"[JSON_SECRET]" | built-in |
| credentialed_uri | URI with embedded username and password | postgres://user:<password>@db.example:5432/app | $1[URI_PASSWORD]$2 | built-in |
| dsn_password | DSN or connection string password assignment | Password=<secret>; | $1[DSN_PASSWORD] | built-in |
| gitlab_pat | GitLab personal access token | glpat-<20+ character token> | [GITLAB_PAT] | built-in |
| azure_sas | Azure SAS signature | https://acct.blob.core.windows.net/container/blob.txt?sv=<version>&sig=<signature> | $1[AZURE_SAS_SIGNATURE] | built-in |
| jwt_token | JSON Web Token | <jwt header>.<jwt payload>.<jwt signature> | [JWT] | built-in |
| ssh_private_key | SSH/PEM private key block | -----BEGIN RSA PRIVATE KEY-----\n<key body>\n-----END RSA PRIVATE KEY----- | [SSH_PRIVATE_KEY] | built-in |
| bearer_token | Bearer authorization token | Bearer <long token body> | Bearer [TOKEN] | built-in |
| home_path | User home directory path | /Users/alice/projects/agent-trail | <home> | built-in |
| home_path_windows | Windows user profile directory path | C:\Users\alice\notes.md | <home> | built-in |

## Rule Pack Schema

Custom rule packs load from `.trail/redactors/**/*.{yaml,yml,json}` and `~/.config/trail/redactors/**/*.{yaml,yml,json}`.

```yaml
name: acme
version: 1
description: ACME internal tokens
allowlist:
  - ACME-PUBLIC-SAMPLE
rules:
  - id: acme_internal_token
    description: ACME internal service token
    regex: 'ACME-[A-Z0-9]{32}'
    placeholder: '[ACME_TOKEN]'
    samples:
      - input: 'ACME-ABCDEF0123456789ABCDEF0123456789'
        redacted: true
      - input: 'ACME-too-short'
        redacted: false
```

Pack invariants: `name` matches the filename stem, `version` is numeric, rule ids are unique within a pack, and rule ids match `[A-Za-z0-9._-]` with max length 64.

Pack load caps: max 1 MiB per file, max 256 files total, recursive subdirectories allowed, symlinks skipped, malformed packs warn and continue.

## Settings Schema

Redaction settings load from `.trail/settings.json` and `~/.config/trail/settings.json`. Project settings load first, then user-global settings, then CLI flags. Array fields merge and dedupe; scalar PII toggles from later settings override earlier settings.

```json
{
  "redaction": {
    "allowedSecrets": ["literal-safe-value"],
    "pii": {
      "email": true,
      "phone": true,
      "ssn": true,
      "credit_card": true,
      "name": true,
      "emailAllowlist": ["*@project.example"],
      "customLabels": {
        "employee_id": "EMP-\\d{6}"
      }
    }
  }
}
```

## PII Retention Note

`@redactpii/node` remains in use for non-phone PII because it provides configurable EMAIL, SSN, CREDIT_CARD, and NAME detection. Agent Trail disables its PHONE rule and uses a guarded phone detector to avoid IP/version false positives observed during #192.
