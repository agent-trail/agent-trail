import type { JsonlRecord } from "@agent-trail/core";
import {
  splitSessionGroups,
  verifyAllSessionContentHashes,
  verifyTrailEnvelopeContentHash,
} from "@agent-trail/core";
import type { IndexEntryKind } from "./index-file.ts";

export type FinalizedObjectIndexRow = {
  contentHash: string;
  kind: IndexEntryKind;
  session_uid: string | null;
};

export type FinalizedObjectIndexPolicy = {
  rows: FinalizedObjectIndexRow[];
  primaryHash: string | undefined;
};

export function finalizedObjectIndexPolicy(records: JsonlRecord[]): FinalizedObjectIndexPolicy {
  const split = splitSessionGroups(records);
  const sessionResults = verifyAllSessionContentHashes(records);
  const envelopeResult = split.envelope !== null ? verifyTrailEnvelopeContentHash(records) : null;

  const rows: FinalizedObjectIndexRow[] = [];
  for (let i = 0; i < sessionResults.length; i += 1) {
    const result = sessionResults[i];
    if (result?.status !== "match" || typeof result.expected !== "string") continue;
    rows.push({
      contentHash: result.expected,
      kind: "session",
      session_uid: extractSessionUidFromHeader(split.groups[i]?.header) ?? null,
    });
  }

  if (envelopeResult?.status === "match" && typeof envelopeResult.expected === "string") {
    rows.push({
      contentHash: envelopeResult.expected,
      kind: "trail",
      session_uid: null,
    });
  }

  const primaryHash =
    envelopeResult?.status === "match" && typeof envelopeResult.expected === "string"
      ? envelopeResult.expected
      : rows.find((row) => row.kind === "session")?.contentHash;

  return { rows, primaryHash };
}

export function finalizedObjectIndexRowForHash(
  records: JsonlRecord[],
  contentHash: string,
): FinalizedObjectIndexRow | undefined {
  return finalizedObjectIndexPolicy(records).rows.find((row) => row.contentHash === contentHash);
}

function extractSessionUidFromHeader(header: JsonlRecord | undefined): string | null {
  const uid = header?.value.session_uid;
  return typeof uid === "string" ? uid : null;
}
