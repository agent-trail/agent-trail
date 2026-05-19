import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";

type CycleStatus = "safe" | "cyclic";

export function validateTrailGraph(records: JsonlRecord[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const headerRecord = records[0];
  if (headerRecord === undefined || headerRecord.value.type !== "session") {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord?.line ?? 0,
        path: "",
        severity: "error",
        code: "missing_header",
        message: 'First line must be a session header with type "session"',
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

  const entries = records.slice(1);

  const idLines = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.value.id;
    if (typeof id !== "string") {
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

  return diagnostics;
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
