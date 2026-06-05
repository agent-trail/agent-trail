import type { Diagnostic, JsonlRecord } from "@agent-trail/core";
import {
  diagnosticFromJsonlParseError,
  JsonlParseError,
  parseJsonlString,
  splitSessionGroups,
  validateTrailGraph,
  validateWriterStrictSchemaJsonlString,
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

export type WriterStrictObjectIndexPolicy =
  | {
      status: "valid";
      records: JsonlRecord[];
      policy: FinalizedObjectIndexPolicy;
    }
  | {
      status: "invalid";
      diagnostics: Diagnostic[];
    };

export async function writerStrictObjectIndexPolicy(
  raw: string,
): Promise<WriterStrictObjectIndexPolicy> {
  let records: JsonlRecord[];
  try {
    records = await parseJsonlString(raw);
  } catch (error) {
    if (error instanceof JsonlParseError) {
      return { status: "invalid", diagnostics: [diagnosticFromJsonlParseError(error)] };
    }
    throw error;
  }

  const schemaDiagnostics = await validateWriterStrictSchemaJsonlString(raw);
  const graphDiagnostics = validateTrailGraph(records);
  const diagnostics = [...schemaDiagnostics, ...graphDiagnostics].filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (diagnostics.length > 0) {
    return { status: "invalid", diagnostics };
  }

  return { status: "valid", records, policy: finalizedObjectIndexPolicy(records) };
}

export function finalizedObjectIndexPolicy(records: JsonlRecord[]): FinalizedObjectIndexPolicy {
  const split = splitSessionGroups(records);
  const sessionResults = verifyAllSessionContentHashes(records);
  const envelopeResult = split.envelope !== null ? verifyTrailEnvelopeContentHash(records) : null;

  const rows: FinalizedObjectIndexRow[] = [];
  for (const [i, group] of split.groups.entries()) {
    const result = sessionResults[i];
    if (result?.status !== "match" || typeof result.expected !== "string") continue;
    rows.push({
      contentHash: result.expected,
      kind: "session",
      session_uid: extractSessionUidFromHeader(group.header),
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

function extractSessionUidFromHeader(header: JsonlRecord): string | null {
  const uid = header.value.session_uid;
  return typeof uid === "string" ? uid : null;
}
