import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import type { Diagnostic } from "@agent-trail/core";
import {
  assertGzippedTrailCompressedSize,
  canonicalizeRecords,
  createDiagnostic,
  decodeGzippedTrailBytes,
  isGzippedTrailPath,
  TrailFileDecodeError,
} from "@agent-trail/core";
import { type IndexEntry, upsertIndexEntry } from "./index-file.ts";
import { writerStrictObjectIndexPolicy } from "./object-index-policy.ts";
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

  const rawResult = await readTrailFileText(filePath);
  if ("diagnostics" in rawResult) {
    return {
      status: "invalid",
      contentHash: null,
      objectPath: null,
      diagnostics: rawResult.diagnostics,
    };
  }
  const raw = rawResult.text;
  const eligible = await writerStrictObjectIndexPolicy(raw);
  if (eligible.status === "invalid") {
    return {
      status: "invalid",
      contentHash: null,
      objectPath: null,
      diagnostics: eligible.diagnostics,
    };
  }

  const { records, policy: indexPolicy } = eligible;
  if (indexPolicy.rows.length === 0) {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }

  // Multi-session files (spec §9.6) write one blob keyed by the envelope hash
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
  // §8.5 envelope-absent default). `finalize-redacted.ts` makes the same
  // choice so register + share/transport agree on identity.
  if (indexPolicy.primaryHash === undefined) {
    return {
      status: "skipped_pending",
      contentHash: null,
      objectPath: null,
      diagnostics: [],
    };
  }
  const primaryTarget = computeObjectPath(storeRoot, indexPolicy.primaryHash);
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
  for (const row of indexPolicy.rows) {
    const target = computeObjectPath(storeRoot, row.contentHash);
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
      session_uid: row.session_uid,
      kind: row.kind,
    };
    await upsertIndexEntry(storeRoot, row.contentHash, entry);
  }

  return {
    status,
    contentHash: indexPolicy.primaryHash,
    objectPath: primaryTarget,
    diagnostics: [],
  };
}

async function readTrailFileText(
  filePath: string,
): Promise<{ text: string } | { diagnostics: Diagnostic[] }> {
  if (!isGzippedTrailPath(filePath)) {
    return { text: await readFile(filePath, "utf8") };
  }

  try {
    const fileInfo = await stat(filePath);
    assertGzippedTrailCompressedSize(filePath, fileInfo.size);
    return { text: await decodeGzippedTrailBytes(await readFile(filePath), filePath) };
  } catch (error) {
    if (error instanceof TrailFileDecodeError) {
      return {
        diagnostics: [
          createDiagnostic({
            line: 0,
            path: "",
            severity: "error",
            code: "gzip_decode_failed",
            message: error.message,
          }),
        ],
      };
    }
    throw error;
  }
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
