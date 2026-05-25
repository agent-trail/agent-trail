import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

const USAGE = "Usage: trail load <url> [--out <path>] [--force]";

const VIEWER_RE = /^https:\/\/agent-trail\.dev\/view\/gist\/([0-9a-f]+)\/?$/;
// Accept optional trailing path segments (e.g. `/raw`, `/revisions/<sha>`) so
// common copy-paste URLs work. GitHub gist IDs are 20–32 hex chars.
const GIST_URL_RE = /^https:\/\/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{20,32})(?:\/[^?#]*)?$/;
const BARE_ID_RE = /^[0-9a-f]{20,32}$/;

const SHORT_HASH_LEN = 12;

const AUTH_ERROR_PATTERNS = [
  /not authenticated/i,
  /authentication/i,
  /access denied/i,
  /\b401\b/,
  /\b403\b/,
  /command not found/i,
  /\bgh\b.*not found/i,
];

function looksLikeAuthError(message: string): boolean {
  return AUTH_ERROR_PATTERNS.some((re) => re.test(message));
}

export function parseSharedTrailUrl(input: string): string {
  let trimmed = input.trim();
  // Strip fragment then query so URL-shape regexes can match against the path.
  const hashIdx = trimmed.indexOf("#");
  if (hashIdx >= 0) trimmed = trimmed.slice(0, hashIdx);
  const queryIdx = trimmed.indexOf("?");
  if (queryIdx >= 0) trimmed = trimmed.slice(0, queryIdx);
  const viewer = VIEWER_RE.exec(trimmed);
  if (viewer) return viewer[1] as string;
  const gist = GIST_URL_RE.exec(trimmed);
  if (gist) return gist[1] as string;
  if (BARE_ID_RE.test(trimmed)) return trimmed;
  throw new Error(
    `unsupported URL: ${input} (expected /view/gist/<id>, gist.github.com/<id>, or bare gist id)`,
  );
}

function decodePayload(payload: Uint8Array): string {
  const base64 = Buffer.from(payload).toString("ascii");
  let raw: Buffer;
  try {
    raw = gunzipSync(Buffer.from(base64, "base64"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`payload is not valid gzipped base64 (${detail})`);
  }
  return raw.toString("utf8");
}

type Values = {
  out: string | undefined;
  force: boolean;
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

  if (values.out !== undefined) {
    const preflight = await preflightOutPath(values.out, values.force);
    if (preflight !== null) return preflight;
  }

  const fetcher = opts.gistFetch ?? ghGistFetch;
  let payload: Uint8Array;
  try {
    const fetched = await fetcher(gistId);
    payload = fetched.payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = looksLikeAuthError(message)
      ? "\nHint: ensure `gh` is installed and authenticated with `gh auth login`."
      : "";
    return {
      exitCode: 1,
      stdout: "",
      stderr: `load: failed to fetch gist: ${message}${hint}\n`,
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
    // The tmp file is deleted in the `finally` below, so recording it as
    // `source_path` would index a guaranteed-stale path. Pass null instead;
    // `trail list` falls back to the content hash for identity.
    const reg = await registerTrail(tmpFile, {
      storeRoot: opts.storeRoot,
      sourcePath: null,
    });

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

async function preflightOutPath(outPath: string, force: boolean): Promise<RunLoadResult | null> {
  let info: Awaited<ReturnType<typeof stat>> | null;
  try {
    info = await stat(outPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (info.isDirectory()) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `load: --out path is a directory: ${outPath}\n`,
    };
  }
  if (!force) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `load: --out path exists: ${outPath}\nHint: pass --force to overwrite.\n`,
    };
  }
  return null;
}
