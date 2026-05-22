import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import type { Diagnostic } from "@agent-trail/core";
import {
  canonicalizeRecords,
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
};

export async function registerTrail(
  filePath: string,
  opts: RegisterOptions = {},
): Promise<RegisterResult> {
  const storeRoot = resolveStoreRoot(opts.storeRoot);

  const raw = await readFile(filePath, "utf8");
  const records = await parseJsonlString(raw);

  const schemaDiagnostics = await validateWriterStrictSchemaJsonlString(raw);
  const graphDiagnostics = validateTrailGraph(records);
  const allDiagnostics = [...schemaDiagnostics, ...graphDiagnostics];
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

  const sourcePath = resolvePath(filePath);
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
  });

  return {
    status,
    contentHash,
    objectPath: target,
    diagnostics: [],
  };
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
  const tmp = `${target}.tmp`;
  await writeFile(tmp, contents, "utf8");
  await rename(tmp, target);
}
