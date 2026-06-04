import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import { envelopeSessionsManifestWarnings } from "./graph-checks.ts";
import type { JsonlRecord } from "./jsonl.ts";
import type { ValidationProfile } from "./profile.ts";
import type { SplitSessionGroupsResult } from "./session-groups.ts";

export type GraphPrologueResult = {
  diagnostics: Diagnostic[];
  headerValidByGroup: boolean[];
};

const readerCompatiblePatchVersionPattern = /^0\.1\.\d+$/;

export function validateGraphPrologue(
  records: JsonlRecord[],
  split: SplitSessionGroupsResult,
  profile: ValidationProfile,
): GraphPrologueResult {
  const diagnostics: Diagnostic[] = [];
  const envelopeRecord = split.envelope ?? undefined;
  const firstGroup = split.groups[0];
  const headerRecord = firstGroup?.header;

  // Detect misplaced and duplicate envelope records before header-validity logic
  // runs, so the diagnostics are stable when both errors coexist.
  for (let i = 1; i < records.length; i += 1) {
    const record = records[i];
    if (record === undefined || record.value.type !== "trail") {
      continue;
    }
    if (envelopeRecord !== undefined) {
      diagnostics.push(
        createDiagnostic({
          line: record.line,
          path: "/type",
          severity: "error",
          code: "multiple_envelopes",
          message: "Trail envelope MUST appear at most once per file",
        }),
      );
    } else {
      diagnostics.push(
        createDiagnostic({
          line: record.line,
          path: "/type",
          severity: "error",
          code: "envelope_not_at_line_1",
          message: "Trail envelope MUST appear at line 1; found at a later line",
        }),
      );
    }
  }

  // Per-group header validity (spec §8.6.3). Each session header is validated
  // independently — a malformed header in any group does not silence checks on
  // siblings. The file-level "missing first header" diagnostic still fires
  // when the file has no recognizable session header at all.
  const headerValidByGroup = split.groups.map(
    (g) =>
      g.header.value.type === "session" &&
      (g.header.value.schema_version === "0.1.0" ||
        (profile === "reader-tolerant" && isReaderCompatiblePatchHeader(g.header))),
  );
  const firstGroupValid = headerValidByGroup[0] ?? false;
  if (!firstGroupValid) {
    if (envelopeRecord !== undefined) {
      diagnostics.push(
        createDiagnostic({
          line: headerRecord?.line ?? records[1]?.line ?? envelopeRecord.line,
          path: "",
          severity: "error",
          code: "missing_header_after_envelope",
          message:
            'Trail envelope at line 1 MUST be followed by a session header on line 2 with type "session" and schema_version "0.1.0"',
        }),
      );
    } else {
      diagnostics.push(
        createDiagnostic({
          line: headerRecord?.line ?? records[0]?.line ?? 0,
          path: "",
          severity: "error",
          code: "missing_header",
          message:
            'First line must be a session header with type "session" and schema_version "0.1.0"',
        }),
      );
    }
  }

  // Every group's header (not just the first) MUST NOT carry a parent_id —
  // session headers are not part of the event graph. Per-record ajv catches
  // some shapes, but `parent_id: null` slips past schema and lands here.
  for (const group of split.groups) {
    const parentId = group.header.value.parent_id;
    if (parentId !== undefined && parentId !== null) {
      diagnostics.push(
        createDiagnostic({
          line: group.header.line,
          path: "/parent_id",
          severity: "error",
          code: "header_has_parent_id",
          message: "Session header must not have a parent_id",
        }),
      );
    }
  }

  // Orphan prelude (spec §8.6): records between the envelope (if any) and the
  // first session header are not part of any group and are always invalid.
  // Suppressed when no session header exists at all — `missing_header` covers
  // that file shape.
  if (firstGroup !== undefined) {
    for (const orphan of split.preludeOrphans) {
      diagnostics.push(
        createDiagnostic({
          line: orphan.line,
          path: "/type",
          severity: "error",
          code: "events_before_first_session_header",
          message: "Entry appears before the first session header",
        }),
      );
    }
  }

  if (envelopeRecord !== undefined) {
    if (envelopeRecord.value.parent_id !== undefined && envelopeRecord.value.parent_id !== null) {
      diagnostics.push(
        createDiagnostic({
          line: envelopeRecord.line,
          path: "/parent_id",
          severity: "error",
          code: "envelope_has_parent_id",
          message: "Trail envelope must not have a parent_id",
        }),
      );
    }
    diagnostics.push(...envelopeSessionsManifestWarnings(envelopeRecord, split.groups));
  }

  // Per-group reader-tolerant patch-version warning (spec §6). Each group's
  // header is independently versioned; a 0.1.x patch acceptance applies per
  // header, not just the first.
  if (profile === "reader-tolerant") {
    for (const group of split.groups) {
      if (isReaderCompatiblePatchHeader(group.header)) {
        diagnostics.push(
          createDiagnostic({
            line: group.header.line,
            path: "/schema_version",
            severity: "warning",
            code: "reader_tolerant_schema_version",
            message: `schema_version "${group.header.value.schema_version}" accepted by reader-tolerant patch compatibility`,
          }),
        );
      }
    }
  }

  return { diagnostics, headerValidByGroup };
}

function isReaderCompatiblePatchHeader(record: JsonlRecord | undefined): boolean {
  return (
    record !== undefined &&
    record.value.type === "session" &&
    typeof record.value.schema_version === "string" &&
    record.value.schema_version !== "0.1.0" &&
    readerCompatiblePatchVersionPattern.test(record.value.schema_version)
  );
}
