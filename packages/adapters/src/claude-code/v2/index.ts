import type { Entry } from "@agent-trail/types";
import { buildTrailEnvelope } from "../../envelope.ts";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../../index.ts";
import { claudeCodeAdapter } from "../index.ts";
import { buildHeader } from "../parser.ts";
import { parseLines } from "../source.ts";
import { claudeCodeV2Adapter } from "./adapter.ts";

export { claudeCodeV2Adapter } from "./adapter.ts";

/**
 * Run the kit-based Claude Code adapter over a source file, returning emitted
 * entries. This is the `parseNew` the diff harness compares against v1.
 */
export async function parseClaudeCodeV2Entries(path: string, sessionUid: string): Promise<Entry[]> {
  return claudeCodeV2Adapter.parse({ path }, { sessionUid });
}

/**
 * Kit-based Claude Code adapter behind the v1 `TrailAdapter` surface: discovery,
 * header, and envelope glue is reused from v1; only entry production is the new
 * kit pipeline. Not wired into the public `claudeCodeAdapter` (later PR).
 */
export const claudeCodeAdapterV2: TrailAdapter = {
  name: "claude-code",
  detectSessions: (opts?: DetectOptions) => claudeCodeAdapter.detectSessions(opts),
  isAvailable: () => claudeCodeAdapter.isAvailable(),
  sourceVersion: () => claudeCodeAdapter.sourceVersion(),
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) throw new Error("Claude Code v2 parseSession requires ref.path");
    const text = await Bun.file(ref.path).text();
    const header = buildHeader(parseLines(text));
    const sessionUid = header.session_uid ?? header.id;
    const entries = await claudeCodeV2Adapter.parse({ path: ref.path }, { sessionUid });
    const envelope = buildTrailEnvelope({
      producer: "@agent-trail/adapters-claude-code-v2",
      header,
    });
    return { envelope, header, entries };
  },
};
