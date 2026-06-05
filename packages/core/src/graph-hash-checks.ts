import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import { verifyContentHash, verifyTrailEnvelopeContentHash } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";
import type { ValidationProfile } from "./profile.ts";
import type { SessionGroup } from "./session-groups.ts";

export function contentHashDiagnostics(
  records: JsonlRecord[],
  groups: SessionGroup[],
  headerValidByGroup: boolean[],
  envelopeRecord: JsonlRecord | undefined,
  profile: ValidationProfile,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let i = 0; i < groups.length; i += 1) {
    if (!headerValidByGroup[i]) continue;
    const group = groups[i] as SessionGroup;
    const hashResult = verifyContentHash(records, { groupIndex: i });
    if (hashResult.status === "invalid") {
      diagnostics.push(
        createDiagnostic({
          line: group.header.line,
          path: "/content_hash",
          severity: "error",
          code: "content_hash_invalid",
          message: "content_hash must be 64 lowercase hex characters",
        }),
      );
    } else if (hashResult.status === "mismatch") {
      diagnostics.push(
        createDiagnostic({
          line: group.header.line,
          path: "/content_hash",
          severity: profile === "reader-tolerant" ? "warning" : "error",
          code: "content_hash_mismatch",
          message: `content_hash does not match canonical bytes (computed ${hashResult.actual})`,
        }),
      );
    }
  }

  if (envelopeRecord !== undefined) {
    const envelopeHashResult = verifyTrailEnvelopeContentHash(records);
    if (envelopeHashResult.status === "invalid") {
      diagnostics.push(
        createDiagnostic({
          line: envelopeRecord.line,
          path: "/content_hash",
          severity: "error",
          code: "content_hash_invalid",
          message: "content_hash must be 64 lowercase hex characters",
        }),
      );
    } else if (envelopeHashResult.status === "mismatch") {
      diagnostics.push(
        createDiagnostic({
          line: envelopeRecord.line,
          path: "/content_hash",
          severity: profile === "reader-tolerant" ? "warning" : "error",
          code: "content_hash_mismatch",
          message: `content_hash does not match canonical bytes (computed ${envelopeHashResult.actual})`,
        }),
      );
    }
  }

  return diagnostics;
}
