import { applyCredentialContext, isOpaqueTokenVisit } from "./credential-context.ts";
import { applyEntropyRedaction } from "./entropy.ts";
import { addMutationCount } from "./mutation-accounting.ts";
import { applyPii } from "./pii.ts";
import { allowedSecretSet, applyPattern } from "./rules.ts";
import type { PiiConfig, RedactionPattern, RedactionSummary } from "./types.ts";
import type { Visit } from "./visits.ts";

export function redactVisitedStrings(
  visits: Iterable<Visit>,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  redactionCounts: Map<number, number>,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): void {
  const allowed = allowedSecretSet(allowedSecrets);
  for (const visit of visits) {
    const before = visit.get();
    let mutationCount = 0;
    const allowlistedSkipsBeforePatterns = summary.counts.allowlisted_skip ?? 0;
    for (const pattern of userPatterns) {
      mutationCount += applyPattern(visit, pattern, summary, maxSamples, allowed);
    }
    for (const pattern of patterns) {
      mutationCount += applyPattern(visit, pattern, summary, maxSamples, allowed);
    }
    const countCredentialAllowlistedSkip =
      (summary.counts.allowlisted_skip ?? 0) === allowlistedSkipsBeforePatterns;
    mutationCount += applyCredentialContext(
      visit,
      summary,
      maxSamples,
      allowed,
      countCredentialAllowlistedSkip,
    );
    if (!isOpaqueTokenVisit(visit)) {
      if (enableEntropyRedaction) {
        mutationCount += applyEntropyRedaction(visit, summary, maxSamples, allowed);
      }
      const beforePii = visit.get();
      const piiResult = applyPii(beforePii, visit.location, summary, maxSamples, pii, allowed);
      if (piiResult.text !== beforePii) {
        visit.set(piiResult.text);
        mutationCount += piiResult.count;
      }
      for (const sample of piiResult.samples) {
        if (summary.samples.length >= maxSamples) break;
        summary.samples.push(sample);
      }
    }
    const next = visit.get();
    if (next !== before) {
      addMutationCount(redactionCounts, visit.recordIndex, mutationCount);
    }
  }
}
