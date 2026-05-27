import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { type JsonlRecord, parseJsonlString } from "@agent-trail/core";
import { type RedactionSummary, redactTrail } from "@agent-trail/redact";
import { registerTrail } from "@agent-trail/store";
import { finalizeRedactedTrail } from "./finalize-redacted.ts";
import { ghGistUpload } from "./gist-upload.ts";

export type RunShareResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type GistUpload = (payload: Uint8Array, filename: string) => Promise<{ gistId: string }>;

export type RunShareOptions = {
  storeRoot?: string;
  confirm?: (message: string) => Promise<boolean>;
  gistUpload?: GistUpload;
};

const VIEWER_BASE = "https://agent-trail.dev/view/gist";

const USAGE =
  "Usage: trail share <path> [--dry-run] [--yes] [--skip-redaction] [--keep-remote-url]";
const SHORT_HASH_LEN = 12;

type Values = {
  "dry-run": boolean;
  yes: boolean;
  "skip-redaction": boolean;
  "keep-remote-url": boolean;
};

export async function runShare(
  argv: string[],
  opts: RunShareOptions = {},
): Promise<RunShareResult> {
  let values: Values;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        "dry-run": { type: "boolean", default: false },
        yes: { type: "boolean", short: "y", default: false },
        "skip-redaction": { type: "boolean", default: false },
        "keep-remote-url": { type: "boolean", default: false },
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
    return { exitCode: 1, stdout: "", stderr: `missing required argument: <path>\n${USAGE}\n` };
  }
  const filePath = positionals[0] as string;

  const reg = await registerTrail(filePath, { storeRoot: opts.storeRoot });
  if (reg.status === "skipped_pending") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `share: trail at ${filePath} missing finalized content_hash (spec §7.3); stamp before sharing\n`,
    };
  }
  if (reg.status === "invalid" || reg.contentHash === null || reg.objectPath === null) {
    const lines = reg.diagnostics.map((d) => d.message).join("\n");
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${lines.length > 0 ? `${lines}\n` : ""}share: trail did not register (status: ${reg.status})\n`,
    };
  }

  let records: JsonlRecord[];
  try {
    const raw = await readFile(reg.objectPath, "utf8");
    records = await parseJsonlString(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 1, stdout: "", stderr: `share: ${message}\n` };
  }

  const stdoutLines: string[] = [];
  let stderr = "";
  stdoutLines.push(`Trail: ${reg.contentHash.slice(0, SHORT_HASH_LEN)} (${reg.contentHash})`);

  let redactedRecords: JsonlRecord[] | null = null;
  if (values["skip-redaction"]) {
    stderr +=
      "WARNING: --skip-redaction will share unredacted trail content. Secrets, file paths, and PII may be exposed.\n";
    stdoutLines.push("Redaction summary: skipped (--skip-redaction)");
  } else {
    if (values["keep-remote-url"]) {
      stderr +=
        "WARNING: --keep-remote-url will share the repository's remote URL in the gist. Project identity (and private repo identity) will be exposed.\n";
    }
    const result = redactTrail(records, { keepRemoteUrl: values["keep-remote-url"] });
    redactedRecords = result.records;
    stdoutLines.push("Redaction summary:");
    stdoutLines.push(...formatSummary(result.summary));
  }

  if (values["dry-run"]) {
    return { exitCode: 0, stdout: `${stdoutLines.join("\n")}\n`, stderr };
  }

  const confirm = opts.confirm ?? defaultConfirm;
  if (!values.yes) {
    const first = await tryConfirm(
      confirm,
      "Share this trail to GitHub Gist? (anyone with the URL can read it)",
    );
    if (!first.ok) {
      stdoutLines.push("Share cancelled.");
      if (first.reason !== null) stderr += `${first.reason}\n`;
      return { exitCode: 0, stdout: `${stdoutLines.join("\n")}\n`, stderr };
    }
    if (values["skip-redaction"]) {
      const second = await tryConfirm(confirm, "Confirm: share without redacting secrets?");
      if (!second.ok) {
        stdoutLines.push("Share cancelled.");
        if (second.reason !== null) stderr += `${second.reason}\n`;
        return { exitCode: 0, stdout: `${stdoutLines.join("\n")}\n`, stderr };
      }
    }
  }

  let payload: Uint8Array;
  let payloadHash: string;
  try {
    let jsonl: Buffer;
    if (values["skip-redaction"]) {
      jsonl = await readFile(reg.objectPath);
      payloadHash = reg.contentHash;
    } else {
      const { canonical, contentHash } = finalizeRedactedTrail(redactedRecords as JsonlRecord[]);
      payloadHash = contentHash;
      jsonl = Buffer.from(canonical, "utf8");
    }
    const gzipped = gzipSync(jsonl);
    const base64 = gzipped.toString("base64");
    payload = Buffer.from(base64, "ascii");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: `${stdoutLines.join("\n")}\n`,
      stderr: `${stderr}share: ${message}\n`,
    };
  }

  const filename = `${payloadHash.slice(0, SHORT_HASH_LEN)}.trail.jsonl.gz.b64`;
  const upload = opts.gistUpload ?? ghGistUpload;
  try {
    const { gistId } = await upload(payload, filename);
    stdoutLines.push(`Shared at: ${VIEWER_BASE}/${gistId}`);
    stdoutLines.push("Note: anyone with the URL can read this gist.");
    return { exitCode: 0, stdout: `${stdoutLines.join("\n")}\n`, stderr };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: `${stdoutLines.join("\n")}\n`,
      stderr: `${stderr}share: gist upload failed: ${message}\nHint: ensure \`gh\` is installed and authenticated with \`gh auth login\`.\n`,
    };
  }
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
        "share: interactive confirmation unavailable (no TTY). Re-run with --yes to bypass prompts.",
    };
  }
}
