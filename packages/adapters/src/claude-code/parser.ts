import type { Header } from "@agent-trail/types";
import { CLAUDE_CODE_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import { type CcEnvelope, isTracerEnvelope, stringValue } from "./source.ts";

// Session-level provenance constants carried on every record. Captured into
// header.meta under the adapter's reverse-DNS namespace for corpus filtering.
// See issue #126.
function provenanceMeta(
  envelopes: CcEnvelope[],
  options: { includeSidechain?: boolean },
): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  const entrypoint = firstString(envelopes, options, "entrypoint");
  if (entrypoint !== undefined) meta["dev.claudecode.entrypoint"] = entrypoint;
  const userType = firstString(envelopes, options, "userType");
  if (userType !== undefined) meta["dev.claudecode.user_type"] = userType;
  return meta;
}

function firstString(
  envelopes: CcEnvelope[],
  options: { includeSidechain?: boolean },
  key: string,
): string | undefined {
  for (const env of envelopes) {
    if (!isTracerEnvelope(env, options)) continue;
    const value = stringValue(env[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function buildHeader(
  envelopes: CcEnvelope[],
  options: { includeSidechain?: boolean } = {},
): Header {
  const first = envelopes.find(
    (env) => isTracerEnvelope(env, options) && env.timestamp !== undefined,
  );
  const firstSession = envelopes.find(
    (env) => isTracerEnvelope(env, options) && env.sessionId !== undefined,
  );
  const firstTs = first?.timestamp;
  if (first === undefined || firstTs === undefined || firstSession?.sessionId === undefined) {
    throw new Error("Claude Code session has no parseable records");
  }
  const firstVersion = first.version ?? firstSession.version;
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id: firstSession.sessionId,
    session_uid: deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, firstSession.sessionId),
    ts: firstTs,
    agent: {
      name: "claude-code",
      ...(firstVersion !== undefined ? { version: firstVersion } : {}),
    },
  };
  if (first.cwd !== undefined) header.cwd = first.cwd;
  const meta = provenanceMeta(envelopes, options);
  if (Object.keys(meta).length > 0) header.meta = meta;
  header.source = {
    agent: "claude-code",
    ...(firstVersion !== undefined ? { format_version: firstVersion } : {}),
  };
  return header;
}
