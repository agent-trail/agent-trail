import type { Entry } from "@agent-trail/types";
import { buildTrailEnvelope } from "../../envelope.ts";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "../../index.ts";
import { piAdapter } from "../index.ts";
import { buildHeader } from "../parser.ts";
import { parseLines, versionString } from "../source.ts";
import { buildPiV2Adapter } from "./adapter.ts";

export { buildPiV2Adapter } from "./adapter.ts";

function sessionVersionOf(text: string): string | undefined {
  return versionString(parseLines(text).find((env) => env.type === "session")?.version);
}

/**
 * Run the kit-based Pi adapter over a source file, returning emitted entries.
 * This is the `parseNew` the diff harness compares against v1's `parseSession`.
 */
export async function parsePiV2Entries(path: string, sessionUid: string): Promise<Entry[]> {
  const text = await Bun.file(path).text();
  return buildPiV2Adapter(sessionVersionOf(text)).parse({ path }, { sessionUid });
}

/**
 * Kit-based Pi adapter behind the v1 `TrailAdapter` surface: discovery, header,
 * and envelope glue is reused from v1; only entry production is the new kit
 * pipeline. Not wired into the public `piAdapter` (flag/removal is a later PR).
 */
export const piAdapterV2: TrailAdapter = {
  name: "pi",
  detectSessions: (opts?: DetectOptions) => piAdapter.detectSessions(opts),
  isAvailable: () => piAdapter.isAvailable(),
  sourceVersion: () => piAdapter.sourceVersion(),
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) throw new Error("Pi v2 parseSession requires ref.path");
    const text = await Bun.file(ref.path).text();
    const header = buildHeader(parseLines(text));
    if (header.session_uid === undefined) {
      throw new Error("Pi header missing session_uid (buildHeader invariant)");
    }
    const entries = await buildPiV2Adapter(sessionVersionOf(text)).parse(
      { path: ref.path },
      { sessionUid: header.session_uid },
    );
    const envelope = buildTrailEnvelope({ producer: "@agent-trail/adapters-pi-v2", header });
    return { envelope, header, entries };
  },
};
