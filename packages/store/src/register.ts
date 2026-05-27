import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import type { Diagnostic, JsonlRecord } from "@agent-trail/core";
import {
  canonicalizeRecords,
  diagnosticFromJsonlParseError,
  JsonlParseError,
  parseJsonlString,
  splitSessionGroups,
  validateTrailGraph,
  validateWriterStrictSchemaJsonlString,
  verifyAllSessionContentHashes,
  verifyTrailEnvelopeContentHash,
} from "@agent-trail/core";
import { type IndexEntry, upsertIndexEntry } from "./index-file.ts";
import { objectPath as computeObjectPath, resolveStoreRoot } from "./paths.ts";

export type RegisterStatus = "finalized" | "already_present" | "skipped_pending" | "invalid";

export type RegisterResult = {
  status: RegisterStatus;
  contentHash: string | null;
  objectPath: string | null;
  diagnostics: Diagnostic[];
};

export type RegisterOptions = {
  storeRoot?: string;
  /**
   * Provenance recorded in the index `source_path` field. Default is the
   * absolute path of `filePath`. Callers that hand `registerTrail` a
   * transient artifact (e.g. a downloaded payload staged in a tmp dir
   * that will be deleted) should pass `null` so the index does not
   * point at a guaranteed-stale path.
   */
  sourcePath?: string | null;
};

export async function registerTrail(
  filePath: string,
  opts: RegisterOptions = {},
): Promise<RegisterResult> {
  const storeRoot = resolveStoreRoot(opts.storeRoot);

  const raw = await readFile(filePath, "utf8");
  let records: JsonlRecord[];
  try {
    records = await parseJsonlString(raw);
  } catch (error) {
    if (error instanceof JsonlParseError) {
      return {
        status: "invalid",
        contentHash: null,
        objectPath: null,
        diagnostics: [diagnosticFromJsonlParseError(error)],
      };
    }
    throw error;
  }

  const schemaDiagnostics = await validateWriterStrictSchemaJsonlString(raw);
  const graphDiagnostics = validateTrailGraph(records);
  const allDiagnostics = [...schemaDiagnostics, ...graphDiagnostics];
  // Only error-severity diagnostics block registration. Warnings
  // (e.g. `unmatched_tool_call_at_eof`) are informational and a trail
  // carrying them is still eligible to be stored as a finalized object.
  const errorDiagnostics = allDiagnostics.filter((d) => d.severity === "error");
  if (errorDiagnostics.length > 0) {
    return {
      status: "invalid",
      contentHash: null,
      objectPath: null,
      diagnostics: errorDiagnostics,
    };
  }

  const split = splitSessionGroups(records);
  const sessionResults = verifyAllSessionContentHashes(records);
  const allFinalized = sessionResults.every((r) => r.status === "match");
  if (sessionResults.length === 0 || !allFinalized) {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }
  const envelopeResult = split.envelope !== null ? verifyTrailEnvelopeContentHash(records) : null;
  if (envelopeResult !== null && envelopeResult.status !== "match") {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }

  // Multi-session files (spec §8.6) write one blob keyed by the envelope hash
  // when present, and one blob per session keyed by its session-level hash.
  // Object storage dedups identical bytes; the index just gains N+1 rows
  // pointing at the same source_path with distinct `kind` discriminators.
  const canonical = canonicalizeRecords(records);
  const sourcePath = opts.sourcePath === undefined ? resolvePath(filePath) : opts.sourcePath;
  const registeredAt = new Date().toISOString();

  // The "primary" content hash returned in RegisterResult: envelope hash when
  // present (file-level identity), otherwise the first session hash. Mirrors
  // finalize-redacted's identity choice (spec §8.0.5 file-identity default).
  const primaryHash = envelopeResult?.expected ?? (sessionResults[0]?.expected as string | null);
  if (primaryHash === null || primaryHash === undefined) {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }
  const primaryTarget = computeObjectPath(storeRoot, primaryHash);
  await mkdir(dirname(primaryTarget), { recursive: true });
  const existing = await readFileIfExists(primaryTarget);
  let status: RegisterStatus;
  if (existing === canonical) {
    status = "already_present";
  } else {
    await atomicWriteFile(primaryTarget, canonical);
    status = "finalized";
  }

  // Per-session index rows. Each row carries the same source_path; the file's
  // canonical bytes already sit at `primaryTarget` so the per-session blobs
  // would be duplicates. Store the same canonical bytes under each session
  // hash too so `trail export <session-hash>` can resolve directly without
  // re-loading the multi-session parent.
  const sessionUidByGroup = split.groups.map(extractSessionUidFromHeader);
  for (let i = 0; i < sessionResults.length; i += 1) {
    const hash = sessionResults[i]?.expected;
    if (typeof hash !== "string") continue;
    const target = computeObjectPath(storeRoot, hash);
    if (target !== primaryTarget) {
      await mkdir(dirname(target), { recursive: true });
      const existingSession = await readFileIfExists(target);
      if (existingSession !== canonical) {
        await atomicWriteFile(target, canonical);
      }
    }
    const entry: IndexEntry = {
      registered_at: registeredAt,
      source_path: sourcePath,
      session_uid: sessionUidByGroup[i] ?? null,
      kind: "session",
    };
    await upsertIndexEntry(storeRoot, hash, entry);
  }

  // Envelope (file-level) row when present.
  if (envelopeResult?.expected && typeof envelopeResult.expected === "string") {
    const entry: IndexEntry = {
      registered_at: registeredAt,
      source_path: sourcePath,
      session_uid: null,
      kind: "trail",
    };
    await upsertIndexEntry(storeRoot, envelopeResult.expected, entry);
  }

  return {
    status,
    contentHash: primaryHash,
    objectPath: primaryTarget,
    diagnostics: [],
  };
}

function extractSessionUidFromHeader(group: { header: JsonlRecord }): string | null {
  const uid = (group.header.value as { session_uid?: unknown }).session_uid;
  return typeof uid === "string" ? uid : null;
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function atomicWriteFile(target: string, contents: string): Promise<void> {
  // Per-write unique suffix so two concurrent calls writing the same target
  // (e.g. duplicate same-hash registers racing in the same store) do not
  // collide on a single shared `.tmp` path. `rename` is atomic on POSIX, so
  // whichever rename wins lands a complete file; the other becomes a no-op
  // overwrite of identical bytes.
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, target);
}
