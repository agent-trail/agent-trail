import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import {
  canonicalizeRecords,
  type JsonlRecord,
  parseJsonlString,
  splitSessionGroups,
} from "@agent-trail/core";
import { type RedactionSummary, redactTrail } from "@agent-trail/redact";
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
import { finalizeRedactedTrail } from "./finalize-redacted.ts";
import { type GistUploadMetadata, ghGistUpload } from "./gist-upload.ts";

export type RunShareResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GistUpload = (
  payload: Uint8Array,
  filename: string,
  metadata?: GistUploadMetadata,
) => Promise<{ gistId: string; warning?: string }>;

export type RunShareOptions = {
  id: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  skipRedaction?: boolean;
  keepRemoteUrl?: boolean;
};

export type RunShareContext = {
  storeRoot?: string;
  confirm?: (message: string) => Promise<boolean>;
  gistUpload?: GistUpload;
};

const VIEWER_BASE = "https://agent-trail.dev/view/gist";

const SHORT_HASH_LEN = 12;
const FULL_HASH_RE = /^[0-9a-f]{64}$/;
const VALID_ID_RE = /^[0-9a-f]{8,64}$/;

type ShareStatus = "dry_run" | "cancelled" | "shared" | "upload_failed";

type ShareSuccessJson = {
  status: ShareStatus;
  content_hash: string;
  redaction: { skipped: boolean; summary: ShareRedactionSummary | null };
  redacted_content_hash?: string;
  gist_id?: string;
  url?: string;
  copied: false;
};

type ShareRedactionSummary = {
  counts: Record<string, number>;
};

type ShareJson =
  | ShareSuccessJson
  | {
      status: "error";
      content_hash: null;
      redaction: null;
      copied: false;
      error: { message: string };
    };

export async function runShare(
  options: RunShareOptions,
  context: RunShareContext = {},
): Promise<RunShareResult> {
  const id = options.id;
  const resolved = await resolveShareId(id, context.storeRoot);
  if ("exitCode" in resolved) return shareErrorReturn(resolved, options);
  const { contentHash, objectFile } = resolved;

  let records: JsonlRecord[];
  try {
    const raw = await readFile(objectFile, "utf8");
    records = extractShareRecords(await parseJsonlString(raw), contentHash);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return shareErrorReturn(
        { exitCode: 1, stdout: "", stderr: `share: unknown id: ${id}\n` },
        options,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return shareErrorReturn({ exitCode: 1, stdout: "", stderr: `share: ${message}\n` }, options);
  }

  const stdoutLines: string[] = [];
  let stderr = "";
  stdoutLines.push(`Trail: ${contentHash.slice(0, SHORT_HASH_LEN)} (${contentHash})`);

  let redactedRecords: JsonlRecord[] | null = null;
  let redactionSummary: RedactionSummary | null = null;
  if (options.skipRedaction === true) {
    stderr +=
      "WARNING: --skip-redaction will share unredacted trail content. Secrets, file paths, and PII may be exposed.\n";
    stdoutLines.push("Redaction summary: skipped (--skip-redaction)");
  } else {
    if (options.keepRemoteUrl === true) {
      stderr +=
        "WARNING: --keep-remote-url will share the repository's remote URL in the gist. Project identity (and private repo identity) will be exposed.\n";
    }
    const result = redactTrail(records, { keepRemoteUrl: options.keepRemoteUrl === true });
    redactedRecords = result.records;
    redactionSummary = result.summary;
    stdoutLines.push("Redaction summary:");
    stdoutLines.push(...formatSummary(result.summary));
  }

  let payloadHash = contentHash;
  if (options.skipRedaction !== true) {
    const finalized = finalizeRedactedTrail(redactedRecords as JsonlRecord[]);
    payloadHash = finalized.contentHash;
    redactedRecords = await parseJsonlString(finalized.canonical);
  }

  if (options.dryRun === true) {
    return shareReturn(
      0,
      `${stdoutLines.join("\n")}\n`,
      stderr,
      options,
      jsonResult(
        "dry_run",
        contentHash,
        options.skipRedaction === true,
        redactionSummary,
        payloadHash,
      ),
    );
  }

  const confirm = context.confirm ?? defaultConfirm;
  if (options.yes !== true) {
    const first = await tryConfirm(
      confirm,
      "Share this trail to GitHub Gist? (anyone with the URL can read it)",
    );
    if (!first.ok) {
      stdoutLines.push("Share cancelled.");
      if (first.reason !== null) stderr += `${first.reason}\n`;
      return shareReturn(
        0,
        `${stdoutLines.join("\n")}\n`,
        stderr,
        options,
        jsonResult(
          "cancelled",
          contentHash,
          options.skipRedaction === true,
          redactionSummary,
          payloadHash,
        ),
      );
    }
  }
  if (options.skipRedaction === true) {
    const second = await tryConfirm(confirm, "Confirm: share without redacting secrets?");
    if (!second.ok) {
      stdoutLines.push("Share cancelled.");
      if (second.reason !== null) stderr += `${second.reason}\n`;
      return shareReturn(
        0,
        `${stdoutLines.join("\n")}\n`,
        stderr,
        options,
        jsonResult("cancelled", contentHash, true, null, payloadHash),
      );
    }
  }

  let payload: Uint8Array;
  try {
    let jsonl: Buffer;
    if (options.skipRedaction === true) {
      jsonl = await readFile(objectFile);
    } else {
      jsonl = Buffer.from(canonicalizePreparedRecords(redactedRecords as JsonlRecord[]), "utf8");
    }
    const gzipped = gzipSync(jsonl);
    const base64 = gzipped.toString("base64");
    payload = Buffer.from(base64, "ascii");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return shareErrorReturn(
      {
        exitCode: 1,
        stdout: options.json === true ? "" : `${stdoutLines.join("\n")}\n`,
        stderr: `${stderr}share: ${message}\n`,
      },
      options,
    );
  }

  const filename = `trail-${payloadHash.slice(0, SHORT_HASH_LEN)}.trail.jsonl.gz.b64`;
  const upload = context.gistUpload ?? ghGistUpload;
  try {
    const shortHash = payloadHash.slice(0, SHORT_HASH_LEN);
    const { gistId, warning } = await upload(payload, filename, {
      contentHash,
      metadataFilename: `trail-${shortHash}`,
      payloadHash,
      redactionSkipped: options.skipRedaction === true,
      title: `Agent Trail share: ${shortHash}`,
      viewerBaseUrl: VIEWER_BASE,
    });
    const url = `${VIEWER_BASE}/${gistId}`;
    if (warning !== undefined && warning.length > 0) {
      stderr += `WARNING: ${warning}\n`;
    }
    stdoutLines.push(`Shared at: ${url}`);
    stdoutLines.push("Note: anyone with the URL can read this gist.");
    return shareReturn(0, `${stdoutLines.join("\n")}\n`, stderr, options, {
      ...jsonResult(
        "shared",
        contentHash,
        options.skipRedaction === true,
        redactionSummary,
        payloadHash,
      ),
      gist_id: gistId,
      url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return shareReturn(
      1,
      `${stdoutLines.join("\n")}\n`,
      `${stderr}share: gist upload failed: ${message}\nHint: ensure \`gh\` is installed and authenticated with \`gh auth login\`.\n`,
      options,
      jsonResult(
        "upload_failed",
        contentHash,
        options.skipRedaction === true,
        redactionSummary,
        payloadHash,
      ),
    );
  }
}

type ResolvedShareId = { contentHash: string; objectFile: string };

async function resolveShareId(
  id: string,
  storeRootOverride: string | undefined,
): Promise<ResolvedShareId | RunShareResult> {
  const storeRoot = resolveStoreRoot(storeRootOverride);
  if (!VALID_ID_RE.test(id)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `share: invalid id: ${id} (expected 8–64 hex chars)\n`,
    };
  }
  let index: IndexFile;
  try {
    index = await readIndex(storeRoot);
  } catch (error) {
    if (error instanceof IndexCorruptError || error instanceof IndexVersionError) {
      return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
    }
    throw error;
  }
  if (FULL_HASH_RE.test(id)) {
    if (index.entries[id] === undefined) {
      return { exitCode: 1, stdout: "", stderr: `share: unknown id: ${id}\n` };
    }
    return { contentHash: id, objectFile: objectPath(storeRoot, id) };
  }
  const matches = Object.keys(index.entries).filter(
    (h) => FULL_HASH_RE.test(h) && h.startsWith(id),
  );
  if (matches.length === 0) {
    return { exitCode: 1, stdout: "", stderr: `share: unknown id: ${id}\n` };
  }
  if (matches.length > 1) {
    const sorted = [...matches].sort();
    return {
      exitCode: 1,
      stdout: "",
      stderr: `share: ambiguous id: ${id} matches ${matches.length} entries:\n${sorted
        .map((h) => `  ${h}`)
        .join("\n")}\n`,
    };
  }
  const contentHash = matches[0] as string;
  return { contentHash, objectFile: objectPath(storeRoot, contentHash) };
}

function extractShareRecords(records: JsonlRecord[], contentHash: string): JsonlRecord[] {
  const split = splitSessionGroups(records);
  if (split.groups.length <= 1) return records;
  const matchIndex = split.groups.findIndex(
    (group) => (group.header.value as { content_hash?: unknown }).content_hash === contentHash,
  );
  if (matchIndex === -1) return records;
  const group = split.groups[matchIndex];
  if (group === undefined) return records;
  const slice = [group.header, ...group.entries];
  return parseCanonicalRecords(canonicalizeRecords(slice));
}

function parseCanonicalRecords(canonical: string): JsonlRecord[] {
  return canonical
    .trimEnd()
    .split("\n")
    .map((raw, index) => ({
      line: index + 1,
      raw,
      value: JSON.parse(raw) as Record<string, unknown>,
    }));
}

function canonicalizePreparedRecords(records: JsonlRecord[]): string {
  return `${records.map((record) => record.raw || JSON.stringify(record.value)).join("\n")}\n`;
}

function jsonResult(
  status: ShareStatus,
  contentHash: string,
  skipped: boolean,
  summary: RedactionSummary | null,
  redactedContentHash: string,
): ShareSuccessJson {
  return {
    status,
    content_hash: contentHash,
    redaction: { skipped, summary: safeRedactionSummary(summary) },
    ...(skipped ? {} : { redacted_content_hash: redactedContentHash }),
    copied: false,
  };
}

function safeRedactionSummary(summary: RedactionSummary | null): ShareRedactionSummary | null {
  if (summary === null) return null;
  return { counts: summary.counts };
}

function shareReturn(
  exitCode: number,
  textStdout: string,
  stderr: string,
  options: RunShareOptions,
  json: ShareJson,
): RunShareResult {
  if (options.json === true) {
    return { exitCode, stdout: `${JSON.stringify(json)}\n`, stderr };
  }
  return { exitCode, stdout: textStdout, stderr };
}

function shareErrorReturn(result: RunShareResult, options: RunShareOptions): RunShareResult {
  if (options.json !== true) return result;
  return {
    exitCode: result.exitCode,
    stdout: `${JSON.stringify({
      status: "error",
      content_hash: null,
      redaction: null,
      copied: false,
      error: { message: result.stderr.trim() || "share failed" },
    } satisfies ShareJson)}\n`,
    stderr: result.stderr,
  };
}

function formatSummary(summary: RedactionSummary): string[] {
  const entries = Object.entries(summary.counts);
  if (entries.length === 0) return ["  (no redactions)"];
  entries.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return entries.map(([id, n]) => `  ${id}: ${n}`);
}

async function defaultConfirm(message: string): Promise<boolean> {
  const answer = prompt(`${message} [y/N]`);
  if (answer === null) return false;
  const trimmed = answer.trim().toLowerCase();
  return trimmed === "y" || trimmed === "yes";
}

type ConfirmOutcome = { ok: boolean; reason: string | null };

async function tryConfirm(
  confirm: (message: string) => Promise<boolean>,
  message: string,
): Promise<ConfirmOutcome> {
  try {
    return { ok: await confirm(message), reason: null };
  } catch {
    return {
      ok: false,
      reason:
        "share: interactive confirmation unavailable (no TTY). Re-run with --yes to bypass standard prompts; unredacted sharing still requires explicit confirmation.",
    };
  }
}

export function addShareCommand(program: Command, writeResult: ResultWriter): void {
  addExamples(
    program
      .command("share")
      .argument("<id>")
      .option("--dry-run", "Redact without uploading.", false)
      .option(
        "-y, --yes",
        "Bypass standard confirmation prompts; unredacted sharing still requires confirmation.",
        false,
      )
      .option("--json", "Print share result as JSON.", false)
      .option("--skip-redaction", "Share raw unredacted trail content.", false)
      .option("--keep-remote-url", "Preserve vcs.remote_url in shared content.", false)
      .description("Redact and share a registered Trail object.")
      .action(async (id: string, options: Omit<RunShareOptions, "id">) => {
        writeResult(
          await runShare({
            id,
            dryRun: options.dryRun,
            yes: options.yes,
            json: options.json,
            skipRedaction: options.skipRedaction,
            keepRemoteUrl: options.keepRemoteUrl,
          }),
        );
      }),
    ["trail share abcdef12", "trail share abcdef12 --dry-run"],
  );
}
