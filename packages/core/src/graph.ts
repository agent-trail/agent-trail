import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import { verifyContentHash } from "./hash.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { resolveValidationProfile, type ValidationProfile } from "./profile.ts";

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

  const headerRecord = records[0];
  const readerTolerantHeaderPatch =
    profile === "reader-tolerant" && isReaderCompatiblePatchHeader(headerRecord);
  const headerValid =
    headerRecord !== undefined &&
    headerRecord.value.type === "session" &&
    (headerRecord.value.schema_version === "0.1.0" || readerTolerantHeaderPatch);
  if (!headerValid) {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord?.line ?? 0,
        path: "",
        severity: "error",
        code: "missing_header",
        message:
          'First line must be a session header with type "session" and schema_version "0.1.0"',
      }),
    );
  } else if (headerRecord.value.parent_id !== undefined && headerRecord.value.parent_id !== null) {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord.line,
        path: "/parent_id",
        severity: "error",
        code: "header_has_parent_id",
        message: "Session header must not have a parent_id",
      }),
    );
  }
  if (readerTolerantHeaderPatch && headerRecord !== undefined) {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord.line,
        path: "/schema_version",
        severity: "warning",
        code: "reader_tolerant_schema_version",
        message: `schema_version "${headerRecord.value.schema_version}" accepted by reader-tolerant patch compatibility`,
      }),
    );
  }

  const entries = records.slice(1);

  const headerId =
    headerRecord !== undefined && typeof headerRecord.value.id === "string"
      ? headerRecord.value.id
      : undefined;

  const idLines = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.value.id;
    if (typeof id !== "string") {
      continue;
    }
    if (id === headerId) {
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: "/id",
          severity: "error",
          code: "duplicate_id",
          message: `Duplicate id "${id}"; first seen on line ${headerRecord?.line ?? 1}`,
        }),
      );
      continue;
    }
    const firstLine = idLines.get(id);
    if (firstLine !== undefined) {
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: "/id",
          severity: "error",
          code: "duplicate_id",
          message: `Duplicate id "${id}"; first seen on line ${firstLine}`,
        }),
      );
      continue;
    }
    idLines.set(id, entry.line);
  }

  const parentOf = new Map<string, string>();
  for (const entry of entries) {
    const id = entry.value.id;
    const parentId = entry.value.parent_id;
    if (typeof parentId !== "string") {
      continue;
    }
    if (!idLines.has(parentId)) {
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
    if (typeof id !== "string") {
      continue;
    }
    if (idLines.get(id) !== entry.line) {
      continue;
    }
    parentOf.set(id, parentId);
  }

  const cyclicIds = findCyclicIds(parentOf);
  const cyclicEntries: { line: number; id: string }[] = [];
  for (const id of cyclicIds) {
    const line = idLines.get(id);
    if (line !== undefined) {
      cyclicEntries.push({ line, id });
    }
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

  if (headerValid && headerRecord !== undefined) {
    diagnostics.push(...streamConsistencyWarnings(headerRecord, entries));
  }

  if (canonicalBytesComplete && headerValid && headerRecord !== undefined) {
    const hashResult = verifyContentHash(records);
    if (hashResult.status === "invalid") {
      diagnostics.push(
        createDiagnostic({
          line: headerRecord.line,
          path: "/content_hash",
          severity: "error",
          code: "content_hash_invalid",
          message: "content_hash must be 64 lowercase hex characters",
        }),
      );
    } else if (hashResult.status === "mismatch") {
      diagnostics.push(
        createDiagnostic({
          line: headerRecord.line,
          path: "/content_hash",
          severity: profile === "reader-tolerant" ? "warning" : "error",
          code: "content_hash_mismatch",
          message: `content_hash does not match canonical bytes (computed ${hashResult.actual})`,
        }),
      );
    }
  }

  return diagnostics;
}

// Checks header stream state against file content (spec §16.4 rule 9): a live
// header (stream.state == "open") must not carry a populated content_hash and
// must not coexist with terminal events. Both checks are conditional on the
// open state; closed/absent streams are validated elsewhere.
function streamConsistencyWarnings(
  headerRecord: JsonlRecord,
  entries: JsonlRecord[],
): Diagnostic[] {
  const stream = headerRecord.value.stream;
  if (typeof stream !== "object" || stream === null) {
    return [];
  }
  const state = (stream as { state?: unknown }).state;
  if (state !== "open") {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const contentHash = headerRecord.value.content_hash;
  if (typeof contentHash === "string" && contentHash !== "<pending>") {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord.line,
        path: "/content_hash",
        severity: "warning",
        code: "stream_open_with_content_hash",
        message:
          'Header has stream.state "open" but content_hash is populated; live files should omit content_hash or use "<pending>"',
      }),
    );
  }

  for (const entry of entries) {
    const type = entry.value.type;
    if (type === "session_end" || type === "session_terminated") {
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: "/type",
          severity: "warning",
          code: "stream_open_with_terminal_event",
          message: `Header has stream.state "open" but file contains a terminal "${type}" event; finalize the header before emitting terminal events`,
        }),
      );
    }
  }

  return diagnostics;
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
