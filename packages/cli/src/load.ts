import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  type ReconcileIncomingResult,
  reconcileIncomingSegment,
  registerTrail,
  resolveStoreRoot,
} from "@agent-trail/store";
import { ghGistFetch } from "./gist-fetch.ts";
import { preflightOutputPath, writeOutputFile } from "./write-output-file.ts";

export type RunLoadResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GistFetch = (gistId: string) => Promise<{ payload: Uint8Array; filename: string }>;

export type RunLoadOptions = {
  url: string;
  out?: string;
  force?: boolean;
};

export type RunLoadContext = {
  storeRoot?: string;
  gistFetch?: GistFetch;
};

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

export async function runLoad(
  options: RunLoadOptions,
  context: RunLoadContext = {},
): Promise<RunLoadResult> {
  let gistId: string;
  try {
    gistId = parseSharedTrailUrl(options.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }

  if (options.out !== undefined) {
    const preflight = await preflightOutputPath("load", options.out, options.force === true);
    if (preflight !== null) return preflight;
  }

  const fetcher = context.gistFetch ?? ghGistFetch;
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
  try {
    const tmpFile = join(tmpDir, "fetched.trail.jsonl");
    // Reconcile against any existing trails with the same session_uid in the
    // store (spec §8.5). When a match is found, register the merged trail
    // instead of the raw incoming bytes; the merged trail's content_hash is
    // what the user actually shared as a logical session.
    const outcome: ReconcileIncomingResult = await reconcileIncomingSegment(
      resolveStoreRoot(context.storeRoot),
      jsonl,
    );
    if (outcome.kind === "merged") {
      jsonl = outcome.canonical;
    }
    await writeFile(tmpFile, jsonl, "utf8");
    // The tmp file is deleted in the `finally` below, so recording it as
    // `source_path` would index a guaranteed-stale path. Pass null instead;
    // `trail list` falls back to the content hash for identity.
    const reg = await registerTrail(tmpFile, {
      storeRoot: context.storeRoot,
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
    if (outcome.kind === "merged") {
      const group = outcome.group;
      stdoutLines.push(
        `Reconciled: ${group.segments.length} segments merged, ${group.events_deduped} events deduped, ${group.warnings.length} warnings (session_uid ${group.session_uid})`,
      );
      for (const warning of group.warnings) {
        stdoutLines.push(`  warning(${warning.code}): ${warning.message}`);
      }
    } else if (outcome.reason === "no_session_uid") {
      stdoutLines.push("Reconciliation skipped: incoming trail has no session_uid");
    } else if (outcome.reason === "invalid_incoming") {
      stdoutLines.push("Reconciliation skipped: incoming trail could not be parsed");
    } else if (outcome.reason === "store_error") {
      stdoutLines.push("Reconciliation skipped: local store unavailable or unreadable");
    } else if (outcome.reason === "corrupt_prior") {
      stdoutLines.push("Reconciliation skipped: prior segments in store could not be read");
    }

    if (options.out !== undefined) {
      const outPath = options.out;
      const canonical = await readFile(reg.objectPath);
      const writeResult = await writeOutputFile("load", outPath, canonical, options.force === true);
      if (writeResult !== null) return writeResult;
      stdoutLines.push(`Wrote: ${outPath}`);
    }

    return { exitCode: 0, stdout: `${stdoutLines.join("\n")}\n`, stderr: "" };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
