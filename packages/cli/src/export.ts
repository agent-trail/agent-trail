import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  IndexCorruptError,
  type IndexFile,
  IndexVersionError,
  objectPath,
  readIndex,
  resolveStoreRoot,
} from "@agent-trail/store";

export type RunExportResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunExportOptions = {
  storeRoot?: string;
};

const USAGE = "Usage: trail export <id> [--out <path>] [--force]";

type Values = {
  out: string | undefined;
  force: boolean;
};

export async function runExport(
  argv: string[],
  opts: RunExportOptions = {},
): Promise<RunExportResult> {
  if (argv.length === 0) {
    return { exitCode: 1, stdout: "", stderr: `missing required argument: <id>\n${USAGE}\n` };
  }

  let values: Values;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        out: { type: "string" },
        force: { type: "boolean", default: false },
      },
      allowPositionals: true,
    });
    values = parsed.values as Values;
    positionals = parsed.positionals;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n${USAGE}\n` };
  }

  if (positionals.length === 0) {
    return { exitCode: 1, stdout: "", stderr: `missing required argument: <id>\n${USAGE}\n` };
  }
  if (positionals.length > 1) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `expected exactly one <id> argument, received ${positionals.length}\n${USAGE}\n`,
    };
  }
  const id = positionals[0] as string;
  const storeRoot = resolveStoreRoot(opts.storeRoot);

  if (!VALID_ID_RE.test(id)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `export: invalid id: ${id} (expected 8–64 hex chars)\n`,
    };
  }

  let contentHash: string;
  if (FULL_HASH_RE.test(id)) {
    contentHash = id;
  } else {
    let index: IndexFile;
    try {
      index = await readIndex(storeRoot);
    } catch (error) {
      if (error instanceof IndexCorruptError || error instanceof IndexVersionError) {
        return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
      }
      throw error;
    }
    // Filter index keys against FULL_HASH_RE before composing a filesystem
    // path. readIndex() only validates that `entries` is a plain object, so a
    // corrupted or malicious index key (e.g. `deadbeef../../etc`) could otherwise
    // be selected as `contentHash` and turned into a path escape via
    // `objectPath(storeRoot, hash)`. Mirrors list.ts:89.
    const matches = Object.keys(index.entries).filter(
      (h) => FULL_HASH_RE.test(h) && h.startsWith(id),
    );
    if (matches.length === 0) {
      return { exitCode: 1, stdout: "", stderr: `export: unknown id: ${id}\n` };
    }
    if (matches.length > 1) {
      const sorted = [...matches].sort();
      return {
        exitCode: 1,
        stdout: "",
        stderr: `export: ambiguous id: ${id} matches ${matches.length} entries:\n${sorted.map((h) => `  ${h}`).join("\n")}\n`,
      };
    }
    contentHash = matches[0] as string;
  }

  let bytes: string;
  try {
    bytes = await readFile(objectPath(storeRoot, contentHash), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exitCode: 1, stdout: "", stderr: `export: unknown id: ${id}\n` };
    }
    throw error;
  }
  if (values.out !== undefined) {
    const outPath = values.out;
    const dirCheck = await checkNotDirectory(outPath);
    if (dirCheck !== null) return dirCheck;
    await mkdir(dirname(outPath), { recursive: true });
    // Use exclusive create (`wx`) for the no-force path so the no-clobber
    // guarantee is atomic. A stat-then-write preflight races against any
    // other writer that creates the file between the two calls; `wx` lets
    // the kernel reject existing paths in a single syscall.
    try {
      await writeFile(outPath, bytes, { flag: values.force ? "w" : "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `export: --out path exists: ${outPath}\nHint: pass --force to overwrite.\n`,
        };
      }
      throw error;
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  return { exitCode: 0, stdout: bytes, stderr: "" };
}

const FULL_HASH_RE = /^[0-9a-f]{64}$/;
const VALID_ID_RE = /^[0-9a-f]{8,64}$/;

// Surfaces a distinct "is a directory" diagnostic up front. The race against
// dir → file replacement between this check and the subsequent write is not
// security-sensitive: the atomic `wx` flag on the write still handles the
// existence-race that the reviewer flagged.
async function checkNotDirectory(outPath: string): Promise<RunExportResult | null> {
  try {
    const info = await stat(outPath);
    if (info.isDirectory()) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `export: --out path is a directory: ${outPath}\n`,
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return null;
}
