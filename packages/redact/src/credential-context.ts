import {
  CREDENTIAL_CONTEXT_PLACEHOLDER,
  isCredentialKey,
  isOpaqueTokenValue,
  isSafeCredentialContextValue,
} from "@agent-trail/core";
import { maskSample } from "./rules.ts";
import type { RedactionSummary } from "./types.ts";
import type { Visit } from "./visits.ts";

const OPAQUE_KEY_PATTERN =
  /^(?:id|parent_id|for_id|call_id|content_hash|overflow_ref|.*_id|.*_hash|.*_ref)$/i;

export function applyCredentialContext(
  visit: Visit,
  summary: RedactionSummary,
  maxSamples: number,
): number {
  if (!isCredentialKey(visit.key)) return 0;
  const current = visit.get();
  if (isSafeCredentialContextValue(current)) return 0;
  visit.set(CREDENTIAL_CONTEXT_PLACEHOLDER);
  summary.counts.credential_context = (summary.counts.credential_context ?? 0) + 1;
  if (summary.samples.length < maxSamples) {
    summary.samples.push({
      patternId: "credential_context",
      location: visit.location,
      before: maskSample(current),
      after: CREDENTIAL_CONTEXT_PLACEHOLDER,
    });
  }
  return 1;
}

export function isOpaqueTokenVisit(visit: Visit): boolean {
  if (!OPAQUE_KEY_PATTERN.test(visit.key ?? "")) return false;
  const current = visit.get();
  return current === "<pending>" || isOpaqueTokenValue(current);
}
