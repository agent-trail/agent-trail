/**
 * Fetch a shared trail payload from a GitHub gist.
 *
 * Requires `gh` on PATH and an authenticated session (`gh auth login`).
 * Subprocess error paths are exercised end-to-end via load.test.ts with an
 * injected fetcher; CI cannot guarantee `gh` availability, so this default
 * is not unit-tested in isolation.
 */
export async function ghGistFetch(
  gistId: string,
): Promise<{ payload: Uint8Array; filename: string }> {
  const listProc = Bun.spawn(["gh", "gist", "view", gistId, "--files"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [listOut, listErr, listCode] = await Promise.all([
    new Response(listProc.stdout).text(),
    new Response(listProc.stderr).text(),
    listProc.exited,
  ]);
  if (listCode !== 0) {
    const detail = listErr.trim().length > 0 ? listErr.trim() : `exit code ${listCode}`;
    throw new Error(`gh gist view --files failed: ${detail}`);
  }
  const files = listOut
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const candidates = files.filter((f) => f.endsWith(".trail.jsonl.gz.b64"));
  if (candidates.length === 0) {
    throw new Error(
      `gist ${gistId} contains no .trail.jsonl.gz.b64 file (found: ${files.join(", ") || "none"})`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `gist ${gistId} contains ${candidates.length} .trail.jsonl.gz.b64 files (${candidates.join(", ")}); expected exactly one`,
    );
  }
  const filename = candidates[0] as string;

  const fetchProc = Bun.spawn(["gh", "gist", "view", gistId, "--raw", "-f", filename], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [fetchOut, fetchErr, fetchCode] = await Promise.all([
    new Response(fetchProc.stdout).bytes(),
    new Response(fetchProc.stderr).text(),
    fetchProc.exited,
  ]);
  if (fetchCode !== 0) {
    const detail = fetchErr.trim().length > 0 ? fetchErr.trim() : `exit code ${fetchCode}`;
    throw new Error(`gh gist view --raw failed: ${detail}`);
  }
  // `gh gist view --raw` appends a trailing newline that is not part of the
  // payload. The payload is base64 ASCII; strip ASCII whitespace bytes at
  // both ends so intermediate buffering or wrappers cannot perturb decoding.
  const isWS = (b: number) => b === 0x0a || b === 0x0d || b === 0x20 || b === 0x09;
  let start = 0;
  while (start < fetchOut.length && isWS(fetchOut[start] as number)) start += 1;
  let end = fetchOut.length;
  while (end > start && isWS(fetchOut[end - 1] as number)) end -= 1;
  return { payload: fetchOut.subarray(start, end), filename };
}
