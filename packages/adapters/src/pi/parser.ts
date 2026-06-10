import type { Header } from "@agent-trail/types";
import {
  canonicalizeIdentityString,
  deriveSessionUid,
  PI_SESSION_UID_NAMESPACE,
} from "../session-uid.ts";
import { type PiEnvelope, timestampToIso, versionString } from "./source.ts";

export function buildHeader(envelopes: PiEnvelope[]): Header {
  const sessionRecord = envelopes.find((env) => env.type === "session");
  if (sessionRecord === undefined) {
    throw new Error("Pi session has no header record");
  }
  const rawId = sessionRecord.id;
  const id = rawId === undefined ? undefined : canonicalizeIdentityString(rawId);
  const ts = timestampToIso(sessionRecord.timestamp);
  if (id === undefined || ts === undefined) {
    throw new Error("Pi session header missing id or timestamp");
  }
  const version = versionString(sessionRecord.version);
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id,
    session_uid: deriveSessionUid(PI_SESSION_UID_NAMESPACE, id),
    ts,
    agent: {
      name: "pi",
      ...(version !== undefined ? { version } : {}),
    },
  };
  if (sessionRecord.cwd !== undefined) header.cwd = sessionRecord.cwd;
  header.source = {
    agent: "pi",
    ...(version !== undefined ? { format_version: version } : {}),
  };
  return header;
}
