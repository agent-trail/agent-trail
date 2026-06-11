import type { JsonlRecord } from "@agent-trail/core";
import { applyRedactionCounts, snapshotToolResultOutputSizes } from "./mutation-accounting.ts";
import { DEFAULT_PATTERNS } from "./patterns.ts";
import { resetContentHashes, stripVcsRemoteUrl, syncRawRecords } from "./record-transforms.ts";
import { userSecretsPatterns } from "./rules.ts";
import {
  applyAttachmentUriRules,
  stripUnresolvedUserQueryResponses,
  stripUnsafeOverflowRefs,
} from "./share-rules.ts";
import { redactVisitedStrings } from "./string-sweep.ts";
import { truncateOutputs } from "./truncate.ts";
import type { RedactionSummary, RedactTrailOptions, RedactTrailResult } from "./types.ts";
import {
  redactUserQueryAnswerKeys,
  redactUserQueryQuestionIds,
  stripSecretUserQueryAnswers,
} from "./user-query.ts";
import { visitStrings } from "./visits.ts";

export function redactTrail(
  records: JsonlRecord[],
  options: RedactTrailOptions = {},
): RedactTrailResult {
  const basePatterns = options.patterns ?? DEFAULT_PATTERNS;
  const patterns = options.extendPatterns
    ? [...basePatterns, ...options.extendPatterns]
    : basePatterns;
  const userPatterns = userSecretsPatterns(options.userSecrets ?? []);
  const includeSourceRaw = options.includeSourceRaw ?? true;
  const outputMaxBytes = options.outputMaxBytes ?? 10_240;
  const maxSamples = options.maxSamples ?? 20;
  const keepRemoteUrl = options.keepRemoteUrl ?? false;
  const out = records.map((record) => structuredClone(record));
  const originalToolResultOutputSizes = snapshotToolResultOutputSizes(out);
  const rawSummary: RedactionSummary = { counts: {}, samples: [] };
  const redactionCounts = new Map<number, number>();

  if (!keepRemoteUrl) {
    stripVcsRemoteUrl(out, rawSummary, maxSamples);
  }

  applyAttachmentUriRules(
    out,
    options.attachmentUriRewrites,
    rawSummary,
    maxSamples,
    redactionCounts,
  );
  stripUnsafeOverflowRefs(out, rawSummary, maxSamples, redactionCounts);
  stripUnresolvedUserQueryResponses(out, rawSummary, maxSamples, redactionCounts);

  const queryIdMaps = redactUserQueryQuestionIds(
    out,
    userPatterns,
    patterns,
    rawSummary,
    maxSamples,
  );
  redactUserQueryAnswerKeys(out, queryIdMaps, userPatterns, patterns, rawSummary, maxSamples);

  stripSecretUserQueryAnswers(out, rawSummary, maxSamples, redactionCounts);

  redactVisitedStrings(
    visitStrings(out, includeSourceRaw),
    userPatterns,
    patterns,
    rawSummary,
    maxSamples,
    redactionCounts,
    options.enableEntropyRedaction === true,
  );

  truncateOutputs(
    out,
    outputMaxBytes,
    rawSummary,
    maxSamples,
    redactionCounts,
    originalToolResultOutputSizes,
  );
  applyRedactionCounts(out, redactionCounts);

  // Redacted bytes differ from the input artifact, so any finalized
  // content_hash carried on the input is now stale. Reset to the
  // <pending> sentinel (spec §7.3) on every session header and on the trail
  // envelope (spec §7.4, §8.6 multi-session) so strict verifiers do not flag
  // the mismatch and so share tooling recomputes the hashes on the redacted
  // artifact before publishing. Skip the reset on a true no-op pass so a
  // finalized clean trail remains verifiable after this call.
  const changed = Object.keys(rawSummary.counts).length > 0;
  if (changed) {
    resetContentHashes(out);
  }

  // Resynchronize JsonlRecord.raw with mutated value so downstream consumers
  // that log or persist `.raw` cannot leak unredacted source text.
  syncRawRecords(out);

  return { records: out, summary: rawSummary };
}
