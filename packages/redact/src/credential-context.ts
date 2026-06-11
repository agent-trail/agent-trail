import { maskSample } from "./rules.ts";
import type { RedactionSummary } from "./types.ts";
import type { Visit } from "./visits.ts";

const CREDENTIAL_KEY_PATTERN =
  /^(?:password|secret|(?:.*_)?(?:api_)?key|.*_token|.*_secret|.*_password|.*_credential|.*_auth|.*_(?:pass|pwd))$/i;

const DB_CREDENTIAL_KEY_PATTERN =
  /^(?:db|database|pg|postgres|postgresql|mysql|mariadb|redis|mongo|mongodb|sqlserver|mssql|jdbc)(?:_.*)?_(?:url|uri|dsn|password|pass|pwd|secret|token|key|credential|auth)$/i;

const PLACEHOLDER_PATTERN = /^\[[A-Z0-9_]+\]$/;
const OPAQUE_KEY_PATTERN =
  /^(?:id|parent_id|for_id|call_id|content_hash|overflow_ref|.*_id|.*_hash|.*_ref)$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_REF_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

export function isCredentialKey(key: string | undefined): boolean {
  if (key === undefined) return false;
  return CREDENTIAL_KEY_PATTERN.test(key) || DB_CREDENTIAL_KEY_PATTERN.test(key);
}

export function applyCredentialContext(
  visit: Visit,
  summary: RedactionSummary,
  maxSamples: number,
): number {
  if (!isCredentialKey(visit.key)) return 0;
  const current = visit.get();
  if (current.length === 0 || PLACEHOLDER_PATTERN.test(current)) return 0;
  visit.set("[CREDENTIAL_VALUE]");
  summary.counts.credential_context = (summary.counts.credential_context ?? 0) + 1;
  if (summary.samples.length < maxSamples) {
    summary.samples.push({
      patternId: "credential_context",
      location: visit.location,
      before: maskSample(current),
      after: "[CREDENTIAL_VALUE]",
    });
  }
  return 1;
}

export function isOpaqueTokenVisit(visit: Visit): boolean {
  if (!OPAQUE_KEY_PATTERN.test(visit.key ?? "")) return false;
  const current = visit.get();
  return (
    current === "<pending>" ||
    UUID_PATTERN.test(current) ||
    SHA256_REF_PATTERN.test(current) ||
    SHA256_HEX_PATTERN.test(current)
  );
}
