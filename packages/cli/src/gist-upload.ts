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
): Promise<{ gistId: string }> {
  const proc = Bun.spawn(["gh", "gist", "create", "--public=false", "--filename", filename, "-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  // Trails are small (typical session <1MB gzipped base64) and `gh` drains
  // stdin eagerly, so an unguarded write is safe in practice.
  proc.stdin.write(payload);
  await proc.stdin.end();
  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const detail = stderrText.trim().length > 0 ? stderrText.trim() : `exit code ${exitCode}`;
    throw new Error(`gh gist create failed: ${detail}`);
  }
  return { gistId: parseGistIdFromGhOutput(stdoutText) };
}

export function parseGistIdFromGhOutput(stdout: string): string {
  const trimmed = stdout.trim();
  const match = /^https:\/\/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]+)$/.exec(trimmed);
  if (!match) {
    throw new Error(`gh gist create: unexpected output (could not parse gist URL): ${trimmed}`);
  }
  return match[1] as string;
}
