import { readFile } from "node:fs/promises";
import {
  canonicalizeRecords,
  computeContentHash,
  parseJsonlString,
  splitSessionGroups,
} from "@agent-trail/core";
import {
  IndexCorruptError,
  type IndexFile,
  IndexVersionError,
  objectPath,
  readIndex,
  resolveStoreRoot,
} from "@agent-trail/store";
import type { Command } from "commander";
import { addExamples, type ResultWriter } from "./command.ts";
import { writeOutputFile } from "./write-output-file.ts";

export type RunExportResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunExportOptions = {
  id: string;
  out?: string;
  force?: boolean;
};

export type RunExportContext = {
  storeRoot?: string;
};

export async function runExport(
  options: RunExportOptions,
  context: RunExportContext = {},
): Promise<RunExportResult> {
  const id = options.id;
  const storeRoot = resolveStoreRoot(context.storeRoot);

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

  // Multi-session extraction (spec §8.6): when `contentHash` keys a session
  // row whose stored file actually contains ≥2 session groups, slice out the
  // requested group's canonical bytes (envelope dropped, sibling groups
  // dropped) so the export is independently verifiable. Single-session files
  // pass through unchanged.
  let extractionStderr = "";
  try {
    const records = await parseJsonlString(bytes);
    const split = splitSessionGroups(records);
    if (split.groups.length > 1) {
      const matchIndex = split.groups.findIndex(
        (g) => (g.header.value as { content_hash?: unknown }).content_hash === contentHash,
      );
      if (matchIndex !== -1) {
        const group = split.groups[matchIndex];
        if (group !== undefined) {
          const slice = [group.header, ...group.entries];
          const sliceBytes = canonicalizeRecords(slice);
          const recomputed = computeContentHash(slice);
          extractionStderr = `export: extracted session group ${matchIndex + 1} of ${split.groups.length} from multi-session file\n`;
          if (recomputed !== contentHash) {
            extractionStderr += `export: warning: extracted session content_hash ${recomputed} does not match stored value ${contentHash}\n`;
          }
          bytes = sliceBytes;
        }
      }
    }
  } catch {
    // Stored bytes failed to parse — fall through and emit the raw bytes as
    // today's behavior. The validator surfaces parse errors via `trail
    // validate` rather than the export verb.
  }
  if (options.out !== undefined) {
    const outPath = options.out;
    const writeResult = await writeOutputFile("export", outPath, bytes, options.force === true);
    if (writeResult !== null) return writeResult;
    return { exitCode: 0, stdout: "", stderr: extractionStderr };
  }

  return { exitCode: 0, stdout: bytes, stderr: extractionStderr };
}

const FULL_HASH_RE = /^[0-9a-f]{64}$/;
const VALID_ID_RE = /^[0-9a-f]{8,64}$/;

export function addExportCommand(program: Command, writeResult: ResultWriter): void {
  addExamples(
    program
      .command("export")
      .argument("<id>")
      .option("--out <path>", "Write exported bytes to a file.")
      .option("--force", "Overwrite --out when it already exists.", false)
      .description("Export a local Trail object.")
      .action(async (id: string, options: Omit<RunExportOptions, "id">) => {
        writeResult(await runExport({ id, out: options.out, force: options.force }));
      }),
    ["trail export abcdef12", "trail export abcdef12 --out exported.trail.jsonl"],
  );
}
