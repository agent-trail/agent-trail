export type RedactionPattern = {
  id: string;
  description: string;
  regex: RegExp;
  placeholder: string;
};

export const CREDENTIAL_CONTEXT_PLACEHOLDER = "[CREDENTIAL_VALUE]";

const CREDENTIAL_KEY_PATTERN =
  /^(?:password|secret|token|(?:.*_)?(?:api_)?key|.*_token|.*_secret|.*_password|.*_credential|.*_auth|.*_(?:pass|pwd))$/i;

const CAMEL_CREDENTIAL_KEY_PATTERN =
  /^(?:(?:api|access|auth|bearer|refresh|client|private|secret|session|database|db|mongo|mongodb|postgres|postgresql|mysql|redis)(?:[A-Z][A-Za-z0-9]*)?(?:Key|Token|Secret|Password|Credential|Auth|Pass|Pwd)|[A-Z][A-Za-z0-9]*(?:Key|Token|Secret|Password|Credential|Auth|Pass|Pwd))$/;

const DB_CREDENTIAL_KEY_PATTERN =
  /^(?:db|database|pg|postgres|postgresql|mysql|mariadb|redis|mongo|mongodb|sqlserver|mssql|jdbc)(?:_.*)?_(?:url|uri|dsn|password|pass|pwd|secret|token|key|credential|auth)$/i;

const PLACEHOLDER_PATTERN = /^\[[A-Z0-9_]+\]$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

export function isCredentialKey(key: string | undefined): boolean {
  if (key === undefined) return false;
  return (
    CREDENTIAL_KEY_PATTERN.test(key) ||
    CAMEL_CREDENTIAL_KEY_PATTERN.test(key) ||
    DB_CREDENTIAL_KEY_PATTERN.test(key)
  );
}

export function isSafeCredentialContextValue(value: string): boolean {
  return value.length === 0 || PLACEHOLDER_PATTERN.test(value) || value === "<pending>";
}

export function isOpaqueTokenValue(value: string): boolean {
  return (
    UUID_PATTERN.test(value) || SHA256_REF_PATTERN.test(value) || SHA256_HEX_PATTERN.test(value)
  );
}

export const OPENAI_API_KEY: RedactionPattern = {
  id: "openai_api_key",
  description: "OpenAI API key",
  regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  placeholder: "[OPENAI_KEY]",
};

export const ANTHROPIC_API_KEY: RedactionPattern = {
  id: "anthropic_api_key",
  description: "Anthropic API key",
  regex: /sk-ant-[A-Za-z0-9_-]{20,}/g,
  placeholder: "[ANTHROPIC_KEY]",
};

export const AWS_ACCESS_KEY: RedactionPattern = {
  id: "aws_access_key",
  description: "AWS access key ID",
  regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  placeholder: "[AWS_ACCESS_KEY]",
};

export const GITHUB_PAT: RedactionPattern = {
  id: "github_pat",
  description: "GitHub personal access token",
  regex: /\bghp_[A-Za-z0-9]{36}\b/g,
  placeholder: "[GITHUB_PAT]",
};

export const GITHUB_OAUTH: RedactionPattern = {
  id: "github_oauth",
  description: "GitHub OAuth token",
  regex: /\b(?:gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g,
  placeholder: "[GITHUB_OAUTH]",
};

export const STRIPE_API_KEY: RedactionPattern = {
  id: "stripe_api_key",
  description: "Stripe API key",
  regex: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
  placeholder: "[STRIPE_KEY]",
};

export const SLACK_TOKEN: RedactionPattern = {
  id: "slack_token",
  description: "Slack token",
  regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  placeholder: "[SLACK_TOKEN]",
};

export const SLACK_WEBHOOK: RedactionPattern = {
  id: "slack_webhook",
  description: "Slack incoming webhook URL",
  regex: /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/g,
  // Keep the https:// prefix so the placeholder still satisfies fields that
  // require a URI scheme (e.g. user_message.payload.attachments[*].uri).
  placeholder: "https://[SLACK_WEBHOOK]",
};

export const GOOGLE_API_KEY: RedactionPattern = {
  id: "google_api_key",
  description: "Google API key",
  regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  placeholder: "[GOOGLE_API_KEY]",
};

export const NPM_TOKEN: RedactionPattern = {
  id: "npm_token",
  description: "npm access token",
  regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
  placeholder: "[NPM_TOKEN]",
};

export const PYPI_TOKEN: RedactionPattern = {
  id: "pypi_token",
  description: "PyPI API token",
  regex: /\bpypi-[A-Za-z0-9_-]{40,}\b/g,
  placeholder: "[PYPI_TOKEN]",
};

export const DATADOG_API_KEY: RedactionPattern = {
  id: "datadog_api_key",
  description: "Datadog API key assignment",
  regex: /\b((?:DATADOG|DD)_API_KEY)=([a-f0-9]{32})\b/gi,
  placeholder: "$1=[DATADOG_KEY]",
};

export const SENTRY_DSN: RedactionPattern = {
  id: "sentry_dsn",
  description: "Sentry DSN",
  regex: /\b(SENTRY_DSN=)?https:\/\/[A-Za-z0-9_-]{16,}@o\d+\.ingest\.sentry\.io\/\d+\b/g,
  placeholder: "$1https://[SENTRY_DSN]",
};

export const TWILIO_AUTH_TOKEN: RedactionPattern = {
  id: "twilio_auth_token",
  description: "Twilio auth token assignment",
  regex: /\b(TWILIO_AUTH_TOKEN)=([a-f0-9]{32})\b/gi,
  placeholder: "$1=[TWILIO_TOKEN]",
};

export const SENDGRID_API_KEY: RedactionPattern = {
  id: "sendgrid_api_key",
  description: "SendGrid API key",
  regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{32,}\b/g,
  placeholder: "[SENDGRID_KEY]",
};

export const CLOUDFLARE_API_TOKEN: RedactionPattern = {
  id: "cloudflare_api_token",
  description: "Cloudflare API token assignment",
  regex: /\b(CLOUDFLARE_(?:API_)?TOKEN)=([A-Za-z0-9_-]{20,})\b/gi,
  placeholder: "$1=[CLOUDFLARE_TOKEN]",
};

export const VERCEL_TOKEN: RedactionPattern = {
  id: "vercel_token",
  description: "Vercel token assignment",
  regex: /\b(VERCEL_TOKEN)=([A-Za-z0-9_-]{20,})\b/gi,
  placeholder: "$1=[VERCEL_TOKEN]",
};

export const HEROKU_API_KEY: RedactionPattern = {
  id: "heroku_api_key",
  description: "Heroku API key assignment",
  regex: /\b(HEROKU_API_KEY)=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi,
  placeholder: "$1=[HEROKU_KEY]",
};

export const TWITTER_BEARER_TOKEN: RedactionPattern = {
  id: "twitter_bearer_token",
  description: "Twitter/X bearer token assignment",
  regex: /\b((?:TWITTER|X)_BEARER_TOKEN)=([A-Za-z0-9%_-]{40,})\b/g,
  placeholder: "$1=[TWITTER_TOKEN]",
};

export const DISCORD_WEBHOOK: RedactionPattern = {
  id: "discord_webhook",
  description: "Discord webhook URL",
  regex: /https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\d{16,20}\/[A-Za-z0-9_-]{40,}/g,
  placeholder: "https://[DISCORD_WEBHOOK]",
};

export const FIREBASE_KEY: RedactionPattern = {
  id: "firebase_key",
  description: "Firebase API key assignment",
  regex: /\b(FIREBASE_API_KEY)=(AIza[0-9A-Za-z_-]{35})\b/g,
  placeholder: "$1=[FIREBASE_KEY]",
};

export const ALGOLIA_API_KEY: RedactionPattern = {
  id: "algolia_api_key",
  description: "Algolia API key assignment",
  regex: /\b(ALGOLIA_API_KEY)=([A-Za-z0-9]{32})\b/gi,
  placeholder: "$1=[ALGOLIA_KEY]",
};

export const MONGODB_ATLAS_URI: RedactionPattern = {
  id: "mongodb_atlas_uri",
  description: "MongoDB Atlas URI with embedded credentials",
  regex: /\bmongodb\+srv:\/\/[^/?#@:\s]+:[^/?#@\s]+@[^/\s]+(?:\/[^\s]*)?/g,
  placeholder: "[MONGODB_ATLAS_URI]",
};

export const DATABASE_URL: RedactionPattern = {
  id: "database_url",
  description: "DATABASE_URL with embedded password",
  regex: /\b(DATABASE_URL=[a-z][a-z0-9+\-.]*:\/\/[^/?#@:\s]+:)[^/?#@\s]+(@[^\s]+)/gi,
  placeholder: "$1[DATABASE_URL_PASSWORD]$2",
};

export const CREDENTIALED_URI: RedactionPattern = {
  id: "credentialed_uri",
  description: "URI with embedded username and password",
  regex: /\b([a-z][a-z0-9+\-.]*:\/\/[^/?#@:\s]+:)[^/?#@[\]\s]+(@[^\s]+)/gi,
  placeholder: "$1[URI_PASSWORD]$2",
};

export const DSN_PASSWORD: RedactionPattern = {
  id: "dsn_password",
  description: "DSN or connection string password assignment",
  regex: /\b((?:password|pwd)\s*=\s*)[^;&\s]+/gi,
  placeholder: "$1[DSN_PASSWORD]",
};

export const JSON_CREDENTIAL_FIELD: RedactionPattern = {
  id: "json_credential_field",
  description: "JSON string field with credential-looking key",
  regex:
    /"((?:password|secret|[A-Za-z0-9_]*(?:_key|_token|_credential|_secret|_password)|(?:db|database|pg|postgres|postgresql|mysql|mariadb|redis|mongo|mongodb|sqlserver|mssql|jdbc)_(?:url|uri|dsn|password|pass|pwd|secret|token|key|credential)))"\s*:\s*"[^"[\]]{8,}"/gi,
  placeholder: '"$1":"[JSON_SECRET]"',
};

export const GITLAB_PAT: RedactionPattern = {
  id: "gitlab_pat",
  description: "GitLab personal access token",
  regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  placeholder: "[GITLAB_PAT]",
};

export const BITBUCKET_APP_PASSWORD: RedactionPattern = {
  id: "bitbucket_app_password",
  description: "Bitbucket app password assignment",
  regex: /\b(BITBUCKET_APP_PASSWORD)=([A-Za-z0-9_-]{20,})\b/gi,
  placeholder: "$1=[BITBUCKET_APP_PASSWORD]",
};

export const AZURE_SAS: RedactionPattern = {
  id: "azure_sas",
  description: "Azure SAS signature",
  regex: /\b(sig=)[A-Za-z0-9%._~+/=-]{20,}/g,
  placeholder: "$1[AZURE_SAS_SIGNATURE]",
};

export const GCP_SERVICE_ACCOUNT_PRIVATE_KEY: RedactionPattern = {
  id: "gcp_service_account_private_key",
  description: "GCP service account private_key JSON field",
  regex:
    /("private_key"\s*:\s*")-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----\\n?(")/g,
  placeholder: "$1[GCP_PRIVATE_KEY]$2",
};

export const JWT_TOKEN: RedactionPattern = {
  id: "jwt_token",
  description: "JSON Web Token",
  regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  placeholder: "[JWT]",
};

export const BEARER_TOKEN: RedactionPattern = {
  id: "bearer_token",
  description: "Bearer authorization token",
  regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  placeholder: "Bearer [TOKEN]",
};

export const SSH_PRIVATE_KEY: RedactionPattern = {
  id: "ssh_private_key",
  description: "SSH/PEM private key block",
  regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  placeholder: "[SSH_PRIVATE_KEY]",
};

export const ENV_ASSIGNMENT: RedactionPattern = {
  id: "env_assignment",
  description: "ENV-style NAME=VALUE assignment with credential-looking value",
  regex:
    /\b((?:[A-Z][A-Z0-9_]{2,}(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIAL|AUTH)|[a-z][a-z0-9_]*(?:key|token|secret|password|pass|pwd|credential|auth)|(?:db|database|pg|postgres|postgresql|mysql|mariadb|redis|mongo|mongodb|sqlserver|mssql|jdbc)(?:_[a-z0-9]+)*(?:_(?:key|token|secret|password|pass|pwd|credential|auth|url|uri|dsn)|url|uri|dsn)))=([A-Za-z0-9_\-.:/+=@?&%]{12,})(?=\s|$)/gi,
  placeholder: "$1=[ENV_SECRET]",
};

export const HOME_PATH: RedactionPattern = {
  id: "home_path",
  description: "User home directory path",
  regex: /\/(?:Users|home)\/[^/\s"'`]+/g,
  placeholder: "<home>",
};

export const HOME_PATH_WINDOWS: RedactionPattern = {
  id: "home_path_windows",
  description: "Windows user profile directory path",
  regex: /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'`]+/g,
  placeholder: "<home>",
};

// Order matters. More specific patterns must come before generic ones so the
// generic pattern does not consume bytes that a more specific pattern would
// have labeled. For example, ANTHROPIC_API_KEY appears before OPENAI_API_KEY
// because `sk-ant-*` would otherwise be claimed by the OpenAI pattern, and
// BEARER_TOKEN appears last so that `Bearer sk-…` is reported as the inner
// vendor key rather than a generic bearer token.
// `userSecrets` literals are applied before any default pattern at call time
// (see redactor.ts), so callers can always override default detection.
// Credential-only patterns. Used by adapter source.raw redaction and the
// validator's source_raw_unredacted_secret check. Excludes path normalization
// patterns (HOME_PATH, HOME_PATH_WINDOWS) — those are share-time concerns,
// not secrets.
export const CREDENTIAL_PATTERNS: RedactionPattern[] = [
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  AWS_ACCESS_KEY,
  GITHUB_PAT,
  GITHUB_OAUTH,
  STRIPE_API_KEY,
  SLACK_TOKEN,
  SLACK_WEBHOOK,
  NPM_TOKEN,
  PYPI_TOKEN,
  DATADOG_API_KEY,
  SENTRY_DSN,
  TWILIO_AUTH_TOKEN,
  SENDGRID_API_KEY,
  CLOUDFLARE_API_TOKEN,
  VERCEL_TOKEN,
  HEROKU_API_KEY,
  TWITTER_BEARER_TOKEN,
  DISCORD_WEBHOOK,
  FIREBASE_KEY,
  GOOGLE_API_KEY,
  ALGOLIA_API_KEY,
  MONGODB_ATLAS_URI,
  DATABASE_URL,
  BITBUCKET_APP_PASSWORD,
  GCP_SERVICE_ACCOUNT_PRIVATE_KEY,
  ENV_ASSIGNMENT,
  JSON_CREDENTIAL_FIELD,
  CREDENTIALED_URI,
  DSN_PASSWORD,
  GITLAB_PAT,
  AZURE_SAS,
  JWT_TOKEN,
  SSH_PRIVATE_KEY,
  BEARER_TOKEN,
];

export const DEFAULT_PATTERNS: RedactionPattern[] = [
  ...CREDENTIAL_PATTERNS,
  HOME_PATH,
  HOME_PATH_WINDOWS,
];
