import type { Header } from "@agent-trail/types";
import { CLAUDE_CODE_SESSION_UID_NAMESPACE, deriveSessionUid } from "../session-uid.ts";
import { type CcEnvelope, isTracerEnvelope } from "./source.ts";

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
  header.source = {
    agent: "claude-code",
    ...(firstVersion !== undefined ? { format_version: firstVersion } : {}),
  };
  return header;
}
