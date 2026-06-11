export const ALLOWED_SECRET_TOKEN_PREFIX = "__AGENT_TRAIL_ALLOWED_SECRET_";

export function containsAllowedSecretToken(value: string): boolean {
  return value.includes(ALLOWED_SECRET_TOKEN_PREFIX);
}
