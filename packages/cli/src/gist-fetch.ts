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
  const filename = files.find((f) => f.endsWith(".trail.jsonl.gz.b64"));
  if (filename === undefined) {
    throw new Error(
      `gist ${gistId} contains no .trail.jsonl.gz.b64 file (found: ${files.join(", ") || "none"})`,
    );
  }

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
  // payload. The payload is base64 ASCII; strip trailing whitespace bytes.
  let end = fetchOut.length;
  while (end > 0) {
    const b = fetchOut[end - 1] as number;
    if (b === 0x0a || b === 0x0d || b === 0x20 || b === 0x09) {
      end -= 1;
    } else break;
  }
  return { payload: fetchOut.subarray(0, end), filename };
}
