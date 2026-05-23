import type { RedactionPattern } from "./types.ts";

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
    /\b([A-Z][A-Z0-9_]{2,}(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIAL|AUTH))=([A-Za-z0-9_\-.:/+=]{12,})/g,
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
export const DEFAULT_PATTERNS: RedactionPattern[] = [
  ANTHROPIC_API_KEY,
  OPENAI_API_KEY,
  AWS_ACCESS_KEY,
  GITHUB_PAT,
  GITHUB_OAUTH,
  STRIPE_API_KEY,
  SLACK_TOKEN,
  SLACK_WEBHOOK,
  GOOGLE_API_KEY,
  JWT_TOKEN,
  SSH_PRIVATE_KEY,
  ENV_ASSIGNMENT,
  BEARER_TOKEN,
  HOME_PATH,
  HOME_PATH_WINDOWS,
];
