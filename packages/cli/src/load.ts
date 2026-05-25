import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { registerTrail } from "@agent-trail/store";
import { ghGistFetch } from "./gist-fetch.ts";

export type RunLoadResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GistFetch = (gistId: string) => Promise<{ payload: Uint8Array; filename: string }>;

export type RunLoadOptions = {
  storeRoot?: string;
  gistFetch?: GistFetch;
};

const USAGE = "Usage: trail load <url> [--out <path>]";

const VIEWER_RE = /^https:\/\/agent-trail\.dev\/view\/gist\/([0-9a-f]+)\/?$/;
const GIST_URL_RE = /^https:\/\/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]+)\/?$/;
const BARE_ID_RE = /^[0-9a-f]{20,40}$/;

const SHORT_HASH_LEN = 12;

export function parseSharedTrailUrl(input: string): string {
  const trimmed = input.trim();
  const viewer = VIEWER_RE.exec(trimmed);
  if (viewer) return viewer[1] as string;
  const gist = GIST_URL_RE.exec(trimmed);
  if (gist) return gist[1] as string;
  if (BARE_ID_RE.test(trimmed)) return trimmed;
  throw new Error(
    `unsupported URL: ${trimmed} (expected /view/gist/<id>, gist.github.com/<id>, or bare gist id)`,
  );
}

function decodePayload(payload: Uint8Array): string {
  const base64 = Buffer.from(payload).toString("ascii");
  return gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
}

type Values = {
  out: string | undefined;
};

export async function runLoad(argv: string[], opts: RunLoadOptions = {}): Promise<RunLoadResult> {
  if (argv.length === 0) {
    return { exitCode: 1, stdout: "", stderr: `missing required argument: <url>\n${USAGE}\n` };
  }

  let values: Values;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        out: { type: "string" },
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
    return { exitCode: 1, stdout: "", stderr: `missing required argument: <url>\n${USAGE}\n` };
  }
  const url = positionals[0] as string;

  let gistId: string;
  try {
    gistId = parseSharedTrailUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }

  const fetcher = opts.gistFetch ?? ghGistFetch;
  let payload: Uint8Array;
  try {
    const fetched = await fetcher(gistId);
    payload = fetched.payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `load: gist fetch failed: ${message}\nHint: ensure \`gh\` is installed and authenticated with \`gh auth login\`.\n`,
    };
  }

  let jsonl: string;
  try {
    jsonl = decodePayload(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `load: failed to decode payload: ${message}\n` };
  }

  const tmpDir = join(tmpdir(), `trail-load-${randomUUID()}`);
  await mkdir(tmpDir, { recursive: true });
  const tmpFile = join(tmpDir, "fetched.trail.jsonl");
  try {
    await writeFile(tmpFile, jsonl, "utf8");
    const reg = await registerTrail(tmpFile, { storeRoot: opts.storeRoot });

    if (reg.status === "skipped_pending") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "load: shared trail missing finalized content_hash (spec §7.3)\n",
      };
    }
    if (reg.status === "invalid" || reg.contentHash === null || reg.objectPath === null) {
      const lines = reg.diagnostics.map((d) => d.message).join("\n");
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${lines.length > 0 ? `${lines}\n` : ""}load: trail did not register (status: ${reg.status})\n`,
      };
    }

    const stdoutLines: string[] = [];
    stdoutLines.push(`Loaded: ${reg.contentHash.slice(0, SHORT_HASH_LEN)} (${reg.contentHash})`);
    stdoutLines.push(`Status: ${reg.status}`);
    stdoutLines.push(`Object: ${reg.objectPath}`);

    if (values.out !== undefined) {
      const outPath = values.out;
      await mkdir(dirname(outPath), { recursive: true });
      const canonical = await readFile(reg.objectPath);
      await writeFile(outPath, canonical);
      stdoutLines.push(`Wrote: ${outPath}`);
    }

    return { exitCode: 0, stdout: `${stdoutLines.join("\n")}\n`, stderr: "" };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
