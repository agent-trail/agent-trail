import { basename } from "node:path";
import type { Header } from "@agent-trail/types";
import type { SessionRef } from "../index.ts";
import {
  deriveSessionUid,
  deriveSynthesizedEntryId,
  OPENCODE_ENTRY_ID_NAMESPACE,
  OPENCODE_SESSION_UID_NAMESPACE,
} from "../session-uid.ts";
import {
  type LoadedSession,
  modelName,
  objectValue,
  partTimestamp,
  type Raw,
  stringValue,
  timestampToIso,
} from "./source.ts";

export function headerFromLoaded(loaded: LoadedSession, ref: SessionRef): Header {
  const session = loaded.session;
  const id = stringValue(session.id) ?? ref.id;
  const time = objectValue(session.time);
  const version = stringValue(session.version);
  const cwd = stringValue(session.directory);
  const model =
    loaded.messages.map((m) => stringValue(m.modelID)).find(Boolean) ?? modelName(session.model);
  const sessionUid = deriveSessionUid(OPENCODE_SESSION_UID_NAMESPACE, id);
  const header: Header = {
    type: "session",
    schema_version: "0.1.0",
    id: deriveSynthesizedEntryId(OPENCODE_ENTRY_ID_NAMESPACE, ["session", id]),
    session_uid: sessionUid,
    ts:
      timestampToIso(time?.created) ??
      timestampToIso(session.time_created) ??
      loaded.messages.map((m) => partTimestamp(m)).find(Boolean) ??
      new Date(0).toISOString(),
    agent: {
      name: "opencode",
      ...(version !== undefined ? { version } : {}),
      ...(model !== undefined ? { model_default: model } : {}),
    },
    source: {
      agent: "opencode",
      ...(version !== undefined ? { format_version: version } : {}),
      ...(ref.path !== undefined ? { path: ref.path } : {}),
    },
  };
  if (cwd !== undefined) header.cwd = cwd;
  const parentId = stringValue(session.parentID) ?? stringValue(session.parent_id);
  if (parentId !== undefined) header.fork_from = { session_id: parentId };
  return header;
}

export function worktreeFromProject(
  project: Raw | undefined,
): NonNullable<NonNullable<Header["vcs"]>["worktree"]> | undefined {
  const worktreePath = stringValue(project?.worktree);
  if (worktreePath === undefined) return undefined;
  return {
    name: stringValue(project?.name) ?? basename(worktreePath),
    path: worktreePath,
  };
}
