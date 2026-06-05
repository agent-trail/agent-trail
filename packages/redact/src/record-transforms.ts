import type { JsonlRecord } from "@agent-trail/core";
import { maskSample } from "./rules.ts";
import type { RedactionSummary } from "./types.ts";

// Removes vcs.remote_url from the header. Default-on per spec §15 / PRD §8.6
// step 7 because the field reveals repository identity (potentially private).
// Records the strip in the summary so share-time previews surface it.
export function stripVcsRemoteUrl(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "session" && value.type !== "trail") continue;
    const vcs = value.vcs as Record<string, unknown> | undefined;
    if (vcs === undefined || typeof vcs.remote_url !== "string") continue;
    const before = vcs.remote_url;
    delete vcs.remote_url;
    summary.counts.vcs_remote_url = (summary.counts.vcs_remote_url ?? 0) + 1;
    if (summary.samples.length < maxSamples) {
      summary.samples.push({
        patternId: "vcs_remote_url",
        location: `records[${index}].vcs.remote_url`,
        before: maskSample(before),
        after: "[STRIPPED]",
      });
    }
  }
}

export function resetContentHashes(records: JsonlRecord[]): void {
  for (const record of records) {
    const value = record.value as Record<string, unknown>;
    if (
      (value.type === "session" || value.type === "trail") &&
      typeof value.content_hash === "string"
    ) {
      value.content_hash = "<pending>";
    }
  }
}

export function syncRawRecords(records: JsonlRecord[]): void {
  for (const record of records) {
    record.raw = JSON.stringify(record.value);
  }
}
