import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import type { Diagnostic, JsonlRecord } from "@agent-trail/core";
import {
  canonicalizeRecords,
  diagnosticFromJsonlParseError,
  JsonlParseError,
  parseJsonlString,
  validateTrailGraph,
  validateWriterStrictSchemaJsonlString,
  verifyContentHash,
} from "@agent-trail/core";
import { upsertIndexEntry } from "./index-file.ts";
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

  const verification = verifyContentHash(records);
  if (
    verification.status === "missing" ||
    verification.status === "pending" ||
    verification.expected === null
  ) {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }
  const contentHash = verification.expected;
  const target = computeObjectPath(storeRoot, contentHash);

  const canonical = canonicalizeRecords(records);
  await mkdir(dirname(target), { recursive: true });

  const sourcePath = opts.sourcePath === undefined ? resolvePath(filePath) : opts.sourcePath;
  const existing = await readFileIfExists(target);
  let status: RegisterStatus;
  if (existing === canonical) {
    status = "already_present";
  } else {
    await atomicWriteFile(target, canonical);
    status = "finalized";
  }

  await upsertIndexEntry(storeRoot, contentHash, {
    registered_at: new Date().toISOString(),
    source_path: sourcePath,
    session_uid: extractSessionUid(records),
  });

  return {
    status,
    contentHash,
    objectPath: target,
    diagnostics: [],
  };
}

function extractSessionUid(records: JsonlRecord[]): string | null {
  for (const record of records) {
    if (record.value.type === "session") {
      const uid = (record.value as { session_uid?: unknown }).session_uid;
      return typeof uid === "string" ? uid : null;
    }
  }
  return null;
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
