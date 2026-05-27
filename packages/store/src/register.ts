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
  const envelopeResult = split.envelope !== null ? verifyTrailEnvelopeContentHash(records) : null;

  // Per-group finalize policy (spec §8.6): a multi-session file may carry a
  // mix of finalized and pending groups. Register every finalized group; skip
  // pending ones without blocking siblings. Register the envelope row only
  // when the envelope itself is finalized. Returns `skipped_pending` only
  // when nothing was registerable.
  const finalizedSessionIndexes: number[] = [];
  for (let i = 0; i < sessionResults.length; i += 1) {
    if (sessionResults[i]?.status === "match") finalizedSessionIndexes.push(i);
  }
  const envelopeFinalized = envelopeResult?.status === "match";
  if (finalizedSessionIndexes.length === 0 && !envelopeFinalized) {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }

  // Multi-session files (spec §8.6) write one blob keyed by the envelope hash
  // when present, and one blob per finalized session keyed by its session-
  // level hash. Object storage dedups identical bytes. The index gains N+1
  // rows pointing at the same source_path with distinct `kind` discriminators
  // — `trail list` therefore renders N session rows plus one trail row per
  // multi-session file rather than a single row per file.
  const canonical = canonicalizeRecords(records);
  const sourcePath = opts.sourcePath === undefined ? resolvePath(filePath) : opts.sourcePath;
  const registeredAt = new Date().toISOString();

  // The "primary" content hash returned in RegisterResult is the file-level
  // identity. Envelope hash when present (spec §7.4 file-level hash); else
  // the first finalized session hash as the surrogate file identity (spec
  // §8.0.5 envelope-absent default). `finalize-redacted.ts` makes the same
  // choice so register + share/transport agree on identity.
  const primaryHash =
    envelopeResult?.status === "match"
      ? (envelopeResult.expected as string)
      : (sessionResults[finalizedSessionIndexes[0] ?? 0]?.expected as string | undefined);
  if (primaryHash === undefined) {
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

  // Per-session index rows for every finalized group. Pending groups are
  // skipped silently; a subsequent register call on the (now-finalized) file
  // picks them up.
  const sessionUidByGroup = split.groups.map(extractSessionUidFromHeader);
  for (const i of finalizedSessionIndexes) {
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

  // Envelope (file-level) row when present and finalized.
  if (envelopeFinalized && typeof envelopeResult?.expected === "string") {
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
