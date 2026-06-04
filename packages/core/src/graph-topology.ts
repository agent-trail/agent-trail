import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";
import type { SessionGroup } from "./session-groups.ts";

type CycleStatus = "safe" | "cyclic";

export type GraphTopologyResult = {
  diagnostics: Diagnostic[];
  groupIdLines: Map<string, number>[];
};

/**
 * Validates identity and parent topology rules for already-split session
 * groups. Header/event IDs are globally unique across the file, while
 * parent_id references resolve only against event IDs inside the same group.
 */
export function validateGraphTopology(
  groups: SessionGroup[],
  envelopeRecord: JsonlRecord | undefined,
): GraphTopologyResult {
  const diagnostics: Diagnostic[] = [];
  const envelopeId =
    envelopeRecord !== undefined && typeof envelopeRecord.value.id === "string"
      ? envelopeRecord.value.id
      : undefined;
  const globalIdLines = new Map<string, number>();

  for (const group of groups) {
    pushUnique(diagnostics, globalIdLines, group.header, envelopeId, envelopeRecord);
    for (const entry of group.entries) {
      pushUnique(diagnostics, globalIdLines, entry, envelopeId, envelopeRecord);
    }
  }

  const groupIdLines = groups.map(collectGroupIds);
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i] as SessionGroup;
    const ids = groupIdLines[i] as Map<string, number>;
    runParentChecks(group.entries, ids, diagnostics);
  }

  return { diagnostics, groupIdLines };
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
