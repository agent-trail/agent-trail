import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type GistUploadMetadata = {
  contentHash: string;
  metadataFilename: string;
  payloadHash: string;
  redactionSkipped: boolean;
  title: string;
  viewerBaseUrl: string;
};

type GhProcess = {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
};

/**
 * Upload a gzipped base64 trail payload to GitHub as an unlisted gist.
 *
 * Requires `gh` on PATH and an authenticated session (`gh auth login`).
 * Subprocess error paths (gh missing, auth failure, non-zero exit) are
 * exercised end-to-end via share.test.ts, not unit-tested here, because
 * CI cannot guarantee `gh` availability.
 */
export async function ghGistUpload(
  payload: Uint8Array,
  filename: string,
  metadata?: GistUploadMetadata,
): Promise<{ gistId: string; warning?: string }> {
  if (metadata === undefined) {
    const proc = Bun.spawn(
      ["gh", "gist", "create", "--public=false", "--filename", filename, "-"],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    // Trails are small (typical session <1MB gzipped base64) and `gh` drains
    // stdin eagerly, so an unguarded write is safe in practice.
    proc.stdin.write(payload);
    await proc.stdin.end();
    const stdoutText = await readGhResult(proc, "gh gist create");
    return { gistId: parseGistIdFromGhOutput(stdoutText) };
  }

  const dir = await mkdtemp(join(tmpdir(), "trail-gist-"));
  try {
    const metadataPath = join(dir, metadata.metadataFilename);
    const payloadPath = join(dir, filename);
    await writeFile(metadataPath, encodeMetadata(buildGistMetadata(metadata)), "utf8");
    await writeFile(payloadPath, payload);

    const createProc = Bun.spawn(gistCreateCommand(metadataPath, payloadPath, metadata.title), {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutText = await readGhResult(createProc, "gh gist create");
    const gistId = parseGistIdFromGhOutput(stdoutText);
    const url = `${metadata.viewerBaseUrl}/${gistId}`;
    const description = `${metadata.title} | Preview: ${url}`;
    await writeFile(metadataPath, encodeMetadata(buildGistMetadata(metadata, gistId, url)), "utf8");

    try {
      const editProc = Bun.spawn(
        gistEditMetadataCommand(gistId, metadata.metadataFilename, metadataPath, description),
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      await readGhResult(editProc, "gh gist edit");
      return { gistId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { gistId, warning: `gist metadata update failed: ${message}` };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function parseGistIdFromGhOutput(stdout: string): string {
  const trimmed = stdout.trim();
  const match = /^https:\/\/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]+)$/.exec(trimmed);
  if (!match) {
    throw new Error(`gh gist create: unexpected output (could not parse gist URL): ${trimmed}`);
  }
  return match[1] as string;
}

export function gistCreateCommand(
  metadataPath: string,
  payloadPath: string,
  description: string,
): string[] {
  return [
    "gh",
    "gist",
    "create",
    "--public=false",
    "--desc",
    description,
    metadataPath,
    payloadPath,
  ];
}

export function gistEditMetadataCommand(
  gistId: string,
  metadataFilename: string,
  metadataPath: string,
  description: string,
): string[] {
  return [
    "gh",
    "gist",
    "edit",
    gistId,
    "--desc",
    description,
    "--filename",
    metadataFilename,
    metadataPath,
  ];
}

export function buildGistMetadata(
  metadata: GistUploadMetadata,
  gistId?: string,
  url?: string,
): Record<string, unknown> {
  return {
    type: "agent-trail-share",
    title: metadata.title,
    content_hash: metadata.contentHash,
    shared_content_hash: metadata.payloadHash,
    redaction: { skipped: metadata.redactionSkipped },
    ...(gistId === undefined ? {} : { gist_id: gistId }),
    ...(url === undefined ? {} : { preview_url: url }),
  };
}

async function readGhResult(
  proc: GhProcess,
  command: "gh gist create" | "gh gist edit",
): Promise<string> {
  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderrText.trim().length > 0 ? stderrText.trim() : `exit code ${exitCode}`;
    throw new Error(`${command} failed: ${detail}`);
  }
  return stdoutText;
}

function encodeMetadata(metadata: Record<string, unknown>): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}
