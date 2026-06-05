import { Database } from "bun:sqlite";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { DetectOptions } from "../../index.ts";
import { opencodeDbPath, opencodeStorageDir } from "../paths.ts";
import {
  isObject,
  type LoadedSession,
  type OpenCodeMessage,
  type OpenCodePart,
  type OpenCodeSessionSummary,
  type OpenCodeTodo,
  parsedJsonObject,
  parsedJsonValue,
  partTimestamp,
  type Raw,
  readJsonFile,
  stringValue,
  timestampToIso,
} from "../source.ts";

export async function pathExists(path: string | undefined): Promise<boolean> {
  if (path === undefined) return false;
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function dirExists(path: string | undefined): Promise<boolean> {
  if (path === undefined) return false;
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function fileSessionSummaries(
  storageDir: string | undefined,
): Promise<OpenCodeSessionSummary[]> {
  if (storageDir === undefined) return [];
  const sessionRoot = join(storageDir, "session");
  if (!(await dirExists(sessionRoot))) return [];
  const out: OpenCodeSessionSummary[] = [];
  const projects = await readdir(sessionRoot, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const dir = join(sessionRoot, project.name);
    const files = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !/^ses_.*\.json$/.test(file.name)) continue;
      const path = join(dir, file.name);
      const raw = await readJsonFile(path);
      if (raw === undefined) continue;
      const id = file.name.replace(/\.json$/, "");
      const cwd = stringValue(raw.directory);
      if (cwd === undefined) continue;
      const time = isObject(raw.time) ? raw.time : {};
      const modifiedAt = timestampToIso(time.updated) ?? (await stat(path)).mtime.toISOString();
      out.push({
        id,
        cwd,
        modifiedAt,
        path,
        version: stringValue(raw.version),
      });
    }
  }
  return out;
}

async function readJsonFilesInDir(dir: string): Promise<Raw[]> {
  const files = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: Raw[] = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    const raw = await readJsonFile(join(dir, file.name));
    if (raw !== undefined) out.push({ ...raw, id: file.name.replace(/\.json$/, "") });
  }
  return out;
}

export async function loadFileSession(path: string): Promise<LoadedSession> {
  const sessionRaw = await readJsonFile(path);
  if (sessionRaw === undefined) throw new Error(`OpenCode session JSON unreadable: ${path}`);
  const id = basename(path).replace(/\.json$/, "");
  const projectID = basename(dirname(path));
  const session = { ...sessionRaw, id, projectID };
  const storageDir = opencodeStorageDir();
  if (storageDir === undefined)
    return {
      session,
      messages: [],
      partsByMessage: new Map(),
      todos: [],
      sessionMessages: [],
      permissions: [],
    };

  const messages = (await readJsonFilesInDir(join(storageDir, "message", id)))
    .filter((raw): raw is OpenCodeMessage => stringValue(raw.id) !== undefined)
    .map((raw) => ({ ...raw, id: stringValue(raw.id) as string }))
    .sort((a, b) => partTimestamp(a).localeCompare(partTimestamp(b)) || a.id.localeCompare(b.id));
  const partsByMessage = new Map<string, OpenCodePart[]>();
  for (const message of messages) {
    const parts = (await readJsonFilesInDir(join(storageDir, "part", message.id)))
      .filter((raw): raw is OpenCodePart => stringValue(raw.id) !== undefined)
      .map((raw) => ({ ...raw, id: stringValue(raw.id) as string }))
      .sort(
        (a, b) =>
          partTimestamp(a, message).localeCompare(partTimestamp(b, message)) ||
          a.id.localeCompare(b.id),
      );
    partsByMessage.set(message.id, parts);
  }
  const todoPath = join(storageDir, "todo", `${id}.json`);
  const todoRaw = await readFile(todoPath, "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .catch(() => []);
  const todos: OpenCodeTodo[] = (Array.isArray(todoRaw) ? todoRaw : [todoRaw]).filter(isObject);
  const enrichment = loadDbMetadataForFileSession(id, session);
  return {
    session: { ...session, ...enrichment.session },
    project: enrichment.project,
    messages,
    partsByMessage,
    todos,
    sessionMessages: enrichment.sessionMessages,
    permissions: enrichment.permissions,
  };
}

function normalizeDbSession(row: Raw): Raw {
  const jsonFields = ["summary_diffs", "revert", "permission", "model", "metadata"];
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      jsonFields.includes(key) ? parsedJsonValue(value) : value,
    ]),
  );
}

function optionalRows(
  db: Database,
  sql: string,
  params: Record<string, string | number | boolean | null>,
): Raw[] {
  try {
    return db.query(sql).all(params).filter(isObject);
  } catch {
    return [];
  }
}

function loadDbMetadataForFileSession(
  id: string,
  fileSession: Raw,
): {
  session: Raw;
  project?: Raw;
  sessionMessages: Raw[];
  permissions: Raw[];
} {
  const dbPath = opencodeDbPath();
  if (dbPath === undefined) return { session: {}, sessionMessages: [], permissions: [] };
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const sessionRow = db.query("SELECT * FROM session WHERE id = $id").get({ $id: id });
    if (!isObject(sessionRow)) return { session: {}, sessionMessages: [], permissions: [] };
    const session = normalizeDbSession(sessionRow);
    if (!canEnrichFileSession(fileSession, session)) {
      return { session: {}, sessionMessages: [], permissions: [] };
    }
    const projectId = stringValue(session.project_id) ?? stringValue(session.projectID);
    const project =
      projectId === undefined
        ? undefined
        : optionalRows(db, "SELECT * FROM project WHERE id = $project", { $project: projectId })[0];
    const sessionMessages = optionalRows(
      db,
      "SELECT * FROM session_message WHERE session_id = $id ORDER BY time_created, id",
      { $id: id },
    ).map(
      (row): Raw => ({
        ...parsedJsonObject(row.data),
        id: stringValue(row.id),
        type: stringValue(row.type),
        sessionID: id,
        time_created: row.time_created,
        time_updated: row.time_updated,
      }),
    );
    const permissions =
      projectId === undefined
        ? []
        : optionalRows(
            db,
            "SELECT * FROM permission WHERE project_id = $project ORDER BY time_created",
            { $project: projectId },
          ).map((row) => ({
            ...row,
            data: parsedJsonValue(row.data),
          }));
    return { session, project, sessionMessages, permissions };
  } catch {
    return { session: {}, sessionMessages: [], permissions: [] };
  } finally {
    db?.close();
  }
}

function canEnrichFileSession(fileSession: Raw, dbSession: Raw): boolean {
  const fileDirectory = stringValue(fileSession.directory);
  const dbDirectory = stringValue(dbSession.directory);
  if (fileDirectory === undefined || dbDirectory === undefined || fileDirectory !== dbDirectory)
    return false;
  const fileProject = stringValue(fileSession.projectID) ?? stringValue(fileSession.project_id);
  const dbProject = stringValue(dbSession.projectID) ?? stringValue(dbSession.project_id);
  return fileProject !== undefined && dbProject !== undefined && fileProject === dbProject;
}

export function loadDbSession(pathWithFragment: string): LoadedSession {
  const [dbPath, id] = pathWithFragment.split("#");
  if (dbPath === undefined || id === undefined)
    throw new Error(`Invalid OpenCode DB ref: ${pathWithFragment}`);
  const db = new Database(dbPath, { readonly: true });
  try {
    const sessionRow = db.query("SELECT * FROM session WHERE id = $id").get({ $id: id });
    if (!isObject(sessionRow)) throw new Error(`OpenCode session not found: ${id}`);
    const session = normalizeDbSession(sessionRow);
    const projectId = stringValue(session.project_id) ?? stringValue(session.projectID);
    const project =
      projectId === undefined
        ? undefined
        : optionalRows(db, "SELECT * FROM project WHERE id = $project", { $project: projectId })[0];
    const messages = db
      .query("SELECT * FROM message WHERE session_id = $id ORDER BY time_created, id")
      .all({ $id: id })
      .filter(isObject)
      .map((row): OpenCodeMessage => {
        const data = parsedJsonObject(row.data);
        return {
          ...data,
          id: stringValue(row.id) ?? stringValue(data.id) ?? "",
          sessionID: id,
          time_created: row.time_created,
          time_updated: row.time_updated,
        };
      })
      .filter((message) => message.id.length > 0);
    const parts = db
      .query("SELECT * FROM part WHERE session_id = $id ORDER BY time_created, id")
      .all({ $id: id })
      .filter(isObject)
      .map((row): OpenCodePart => {
        const data = parsedJsonObject(row.data);
        return {
          ...data,
          id: stringValue(row.id) ?? stringValue(data.id) ?? "",
          sessionID: id,
          messageID: stringValue(row.message_id) ?? stringValue(data.messageID),
          time_created: row.time_created,
          time_updated: row.time_updated,
        };
      })
      .filter((part) => part.id.length > 0);
    const partsByMessage = new Map<string, OpenCodePart[]>();
    for (const part of parts) {
      const messageID = stringValue(part.messageID) ?? stringValue(part.message_id);
      if (messageID === undefined) continue;
      partsByMessage.set(messageID, [...(partsByMessage.get(messageID) ?? []), part]);
    }
    const todos: OpenCodeTodo[] = db
      .query("SELECT * FROM todo WHERE session_id = $id ORDER BY position")
      .all({ $id: id })
      .filter(isObject);
    const sessionMessages = optionalRows(
      db,
      "SELECT * FROM session_message WHERE session_id = $id ORDER BY time_created, id",
      { $id: id },
    ).map(
      (row): Raw => ({
        ...parsedJsonObject(row.data),
        id: stringValue(row.id),
        type: stringValue(row.type),
        sessionID: id,
        time_created: row.time_created,
        time_updated: row.time_updated,
      }),
    );
    const permissions =
      projectId === undefined
        ? []
        : optionalRows(
            db,
            "SELECT * FROM permission WHERE project_id = $project ORDER BY time_created",
            { $project: projectId },
          ).map((row) => ({
            ...row,
            data: parsedJsonValue(row.data),
          }));
    return { session, project, messages, partsByMessage, todos, sessionMessages, permissions };
  } finally {
    db.close();
  }
}

function sqliteSessionSummaries(dbPath: string | undefined): OpenCodeSessionSummary[] {
  if (dbPath === undefined) return [];
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    return db
      .query(
        `SELECT id, directory, title, version, time_updated
         FROM session
         ORDER BY time_updated DESC, id ASC`,
      )
      .all()
      .flatMap((row): OpenCodeSessionSummary[] => {
        if (!isObject(row)) return [];
        const id = stringValue(row.id);
        const cwd = stringValue(row.directory);
        const modifiedAt = timestampToIso(row.time_updated);
        if (id === undefined || cwd === undefined || modifiedAt === undefined) return [];
        return [
          {
            id,
            cwd,
            modifiedAt,
            path: `${dbPath}#${id}`,
            version: stringValue(row.version),
          },
        ];
      });
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function discoveredSummaries(
  opts: DetectOptions = {},
): Promise<OpenCodeSessionSummary[]> {
  const fileRefs = await fileSessionSummaries(opencodeStorageDir());
  const fileIds = new Set(fileRefs.map((ref) => ref.id));
  const dbRefs = sqliteSessionSummaries(opencodeDbPath()).filter((ref) => !fileIds.has(ref.id));
  const effectiveCwd = opts.cwd ?? process.cwd();
  return [...fileRefs, ...dbRefs]
    .filter((ref) => opts.allCwds === true || ref.cwd === effectiveCwd)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.id.localeCompare(b.id));
}
