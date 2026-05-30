import type { Entry } from "@agent-trail/types";
import { buildTrailEnvelope } from "../../envelope.ts";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../../index.ts";
import { codexAdapter } from "../index.ts";
import { buildHeader } from "../parser.ts";
import { parseLines } from "../source.ts";
import { codexV2Adapter } from "./adapter.ts";

export { codexV2Adapter } from "./adapter.ts";

function headerOf(text: string) {
  const first = (parseLines(text)[0] ?? {}) as Record<string, unknown>;
  return buildHeader(first);
}

/**
 * Run the kit-based Codex adapter over a source file, returning emitted entries.
 * This is the `parseNew` the diff harness compares against v1's `parseSession`.
 */
export async function parseCodexV2Entries(path: string, sessionUid: string): Promise<Entry[]> {
  return codexV2Adapter.parse({ path }, { sessionUid });
}

/**
 * Kit-based Codex adapter behind the v1 `TrailAdapter` surface: discovery,
 * header, and envelope glue is reused from v1; only entry production is the new
 * kit pipeline. Not wired into the public `codexAdapter` (later PR).
 */
export const codexAdapterV2: TrailAdapter = {
  name: "codex",
  detectSessions: (opts?: DetectOptions) => codexAdapter.detectSessions(opts),
  isAvailable: () => codexAdapter.isAvailable(),
  sourceVersion: () => codexAdapter.sourceVersion(),
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) throw new Error("Codex v2 parseSession requires ref.path");
    const text = await Bun.file(ref.path).text();
    const header = headerOf(text);
    const sessionUid = header.session_uid ?? header.id;
    const entries = await codexV2Adapter.parse({ path: ref.path }, { sessionUid });
    const envelope = buildTrailEnvelope({ producer: "@agent-trail/adapters-codex-v2", header });
    return { envelope, header, entries };
  },
};
