import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import {
  agentMessageUsageWarnings,
  crossGroupForkFromWarnings,
  envelopeRefWarnings,
  envelopeSessionsManifestWarnings,
  finalMessageIdWarnings,
  outOfOrderSessionHeadersWarnings,
  streamConsistencyWarnings,
  unmatchedToolCallWarnings,
  vcsRevisionDivergenceWarnings,
} from "./graph-checks.ts";
import { verifyContentHash, verifyTrailEnvelopeContentHash } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { resolveValidationProfile, type ValidationProfile } from "./profile.ts";
import { type SessionGroup, splitSessionGroups } from "./session-groups.ts";

type CycleStatus = "safe" | "cyclic";

export type ValidateTrailGraphOptions = {
  canonicalBytesComplete?: boolean;
  profile?: ValidationProfile;
};

const readerCompatiblePatchVersionPattern = /^0\.1\.\d+$/;

export function validateTrailGraph(
  records: JsonlRecord[],
  options: ValidateTrailGraphOptions = {},
): Diagnostic[] {
  const canonicalBytesComplete = options.canonicalBytesComplete ?? true;
  const profile = resolveValidationProfile(options.profile);
  const diagnostics: Diagnostic[] = [];

  const split = splitSessionGroups(records);
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

  // Header-and-event IDs are globally unique within a file (spec §7.5), so
  // collect every group's headers and entries together for the uniqueness
  // check. parent_id resolution stays per-group (cross-group references go
  // through fork_from, not parent_id).
  const envelopeId =
    envelopeRecord !== undefined && typeof envelopeRecord.value.id === "string"
      ? envelopeRecord.value.id
      : undefined;
  const idLines = new Map<string, number>();
  for (const group of split.groups) {
    pushUnique(diagnostics, idLines, group.header, envelopeId, envelopeRecord);
    for (const entry of group.entries) {
      pushUnique(diagnostics, idLines, entry, envelopeId, envelopeRecord);
    }
  }

  for (const group of split.groups) {
    const groupIds = collectGroupIds(group);
    runParentChecks(group.entries, groupIds, diagnostics);
  }

  // Per-group downstream checks. A group with an invalid header is skipped
  // individually — sibling groups with valid headers still get their checks.
  for (let i = 0; i < split.groups.length; i += 1) {
    if (!headerValidByGroup[i]) continue;
    const group = split.groups[i] as SessionGroup;
    diagnostics.push(...streamConsistencyWarnings(group.header, group.entries));
    diagnostics.push(...unmatchedToolCallWarnings(group.entries));
    const groupIdLines = collectGroupIds(group);
    const groupHeaderId =
      typeof group.header.value.id === "string" ? group.header.value.id : undefined;
    diagnostics.push(...finalMessageIdWarnings(group.entries, groupIdLines, groupHeaderId));
    diagnostics.push(...envelopeRefWarnings(group.entries, groupIdLines));
    diagnostics.push(...agentMessageUsageWarnings(group.entries));
  }
  // File-scoped cross-group warnings only fire when there are ≥2 groups AND
  // every group has a valid header (otherwise the cross-group comparison
  // would compare against malformed inputs).
  if (split.groups.length > 1 && headerValidByGroup.every(Boolean)) {
    diagnostics.push(...outOfOrderSessionHeadersWarnings(split.groups));
    diagnostics.push(...vcsRevisionDivergenceWarnings(split.groups));
    diagnostics.push(...crossGroupForkFromWarnings(split.groups));
  }

  if (canonicalBytesComplete) {
    for (let i = 0; i < split.groups.length; i += 1) {
      if (!headerValidByGroup[i]) continue;
      const group = split.groups[i] as SessionGroup;
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
  }

  return diagnostics;
}

function pushUnique(
  diagnostics: Diagnostic[],
  idLines: Map<string, number>,
  record: JsonlRecord,
  envelopeId: string | undefined,
  envelopeRecord: JsonlRecord | undefined,
): void {
  const id = record.value.id;
  if (typeof id !== "string") return;
  if (id === envelopeId && envelopeRecord !== undefined) {
    diagnostics.push(
      createDiagnostic({
        line: record.line,
        path: "/id",
        severity: "error",
        code: "duplicate_id",
        message: `Duplicate id "${id}"; first seen on line ${envelopeRecord.line}`,
      }),
    );
    return;
  }
  const firstLine = idLines.get(id);
  if (firstLine !== undefined) {
    diagnostics.push(
      createDiagnostic({
        line: record.line,
        path: "/id",
        severity: "error",
        code: "duplicate_id",
        message: `Duplicate id "${id}"; first seen on line ${firstLine}`,
      }),
    );
    return;
  }
  idLines.set(id, record.line);
}

function collectGroupIds(group: SessionGroup): Map<string, number> {
  // Header id intentionally excluded: spec §9.1 treats `parent_id` as event
  // graph topology only; a `parent_id` pointing at the session header is an
  // unresolved reference.
  const ids = new Map<string, number>();
  for (const entry of group.entries) {
    const id = entry.value.id;
    if (typeof id !== "string") continue;
    if (!ids.has(id)) ids.set(id, entry.line);
  }
  return ids;
}

function runParentChecks(
  entries: JsonlRecord[],
  groupIds: Map<string, number>,
  diagnostics: Diagnostic[],
): void {
  const parentOf = new Map<string, string>();
  for (const entry of entries) {
    const id = entry.value.id;
    const parentId = entry.value.parent_id;
    if (typeof parentId !== "string") continue;
    if (!groupIds.has(parentId)) {
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: "/parent_id",
          severity: "error",
          code: "unknown_parent_id",
          message: `parent_id "${parentId}" does not reference an id in this file`,
        }),
      );
      continue;
    }
    if (typeof id !== "string") continue;
    const firstLine = groupIds.get(id);
    if (firstLine !== entry.line) continue;
    parentOf.set(id, parentId);
  }

  const cyclic = findCyclicIds(parentOf);
  const cyclicEntries: { line: number; id: string }[] = [];
  for (const id of cyclic) {
    const line = groupIds.get(id);
    if (line !== undefined) cyclicEntries.push({ line, id });
  }
  cyclicEntries.sort((a, b) => a.line - b.line);
  for (const { line, id } of cyclicEntries) {
    diagnostics.push(
      createDiagnostic({
        line,
        path: "/parent_id",
        severity: "error",
        code: "parent_cycle",
        message: `parent_id chain for id "${id}" forms a cycle`,
      }),
    );
  }
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

function findCyclicIds(parentOf: Map<string, string>): Set<string> {
  const status = new Map<string, CycleStatus>();
  const cyclic = new Set<string>();

  for (const startId of parentOf.keys()) {
    if (status.has(startId)) {
      continue;
    }
    const path: string[] = [];
    const indexInPath = new Map<string, number>();
    let cursor: string | undefined = startId;
    let resolution: CycleStatus | "open" = "open";
    let cycleStartIndex = -1;

    while (cursor !== undefined) {
      const known = status.get(cursor);
      if (known !== undefined) {
        resolution = known;
        break;
      }
      const existingIndex = indexInPath.get(cursor);
      if (existingIndex !== undefined) {
        resolution = "cyclic";
        cycleStartIndex = existingIndex;
        break;
      }
      indexInPath.set(cursor, path.length);
      path.push(cursor);
      cursor = parentOf.get(cursor);
    }

    if (resolution === "cyclic" && cycleStartIndex >= 0) {
      for (let i = 0; i < path.length; i += 1) {
        const node = path[i];
        if (node === undefined) {
          continue;
        }
        if (i >= cycleStartIndex) {
          status.set(node, "cyclic");
          cyclic.add(node);
        } else {
          status.set(node, "safe");
        }
      }
    } else {
      const finalStatus: CycleStatus = resolution === "cyclic" ? "cyclic" : "safe";
      for (const id of path) {
        status.set(id, finalStatus);
      }
    }
  }

  return cyclic;
}
