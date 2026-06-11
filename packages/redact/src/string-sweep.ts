import { applyCredentialContext, isOpaqueTokenVisit } from "./credential-context.ts";
import { applyEntropyRedaction } from "./entropy.ts";
import { addMutationCount } from "./mutation-accounting.ts";
import { applyPii } from "./pii.ts";
import { applyPattern } from "./rules.ts";
import type { RedactionPattern, RedactionSummary } from "./types.ts";
import type { Visit } from "./visits.ts";

export function redactVisitedStrings(
  visits: Iterable<Visit>,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
  redactionCounts: Map<number, number>,
  enableEntropyRedaction: boolean,
): void {
  for (const visit of visits) {
    for (const pattern of userPatterns) {
      addMutationCount(
        redactionCounts,
        visit.recordIndex,
        applyPattern(visit, pattern, summary, maxSamples),
      );
    }
    for (const pattern of patterns) {
      addMutationCount(
        redactionCounts,
        visit.recordIndex,
        applyPattern(visit, pattern, summary, maxSamples),
      );
    }
    addMutationCount(
      redactionCounts,
      visit.recordIndex,
      applyCredentialContext(visit, summary, maxSamples),
    );
    if (isOpaqueTokenVisit(visit)) continue;
    if (enableEntropyRedaction) {
      addMutationCount(
        redactionCounts,
        visit.recordIndex,
        applyEntropyRedaction(visit, summary, maxSamples),
      );
    }
    const current = visit.get();
    const pii = applyPii(current, visit.location, summary, maxSamples);
    if (pii.text !== current) {
      visit.set(pii.text);
      addMutationCount(redactionCounts, visit.recordIndex, pii.count);
    }
    for (const sample of pii.samples) {
      if (summary.samples.length >= maxSamples) break;
      summary.samples.push(sample);
    }
  }
}
