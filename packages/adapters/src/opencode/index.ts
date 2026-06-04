import { Database } from "bun:sqlite";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseJsonlString, stampTrail } from "@agent-trail/core";
import type { Attachment, Entry, Header, ToolKind } from "@agent-trail/types";
import pkg from "../../package.json" with { type: "json" };
import { buildTrailEnvelope } from "../envelope.ts";
import type {
  AdapterSourceHealth,
  DetectOptions,
  SessionRef,
  TrailAdapter,
  TrailFile,
} from "../index.ts";
import { applyParseFidelity } from "../parse-fidelity.ts";
import {
  deriveSessionUid,
  deriveSynthesizedEntryId,
  OPENCODE_ENTRY_ID_NAMESPACE,
  OPENCODE_SESSION_UID_NAMESPACE,
} from "../session-uid.ts";
import { enforceSourceRawSize, redactValue } from "../source-raw.ts";
import { readGitVcs } from "../vcs.ts";
import { opencodeDataDir, opencodeDbPath, opencodeStorageDir } from "./paths.ts";

const PRODUCER = `@agent-trail/adapters-opencode/${pkg.version}`;
const SOURCE_SCHEMA_VERSION = "v1";
const KNOWN_PART_TYPES = new Set([
  "text",
  "subtask",
  "reasoning",
  "file",
  "tool",
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "retry",
  "compaction",
]);

type Raw = Record<string, unknown>;

type OpenCodeSessionSummary = {
  id: string;
  cwd: string;
  modifiedAt: string;
  path: string;
  version?: string;
};

type OpenCodeMessage = Raw & {
  id: string;
  role?: string;
  time?: Raw;
};

type OpenCodePart = Raw & {
  id: string;
  type?: string;
  messageID?: string;
  message_id?: string;
  time?: Raw;
};

type OpenCodeTodo = Raw & {
  content?: string;
  status?: string;
  position?: number;
  time?: Raw;
};

type LoadedSession = {
  session: Raw;
  project?: Raw;
  messages: OpenCodeMessage[];
  partsByMessage: Map<string, OpenCodePart[]>;
  todos: OpenCodeTodo[];
  sessionMessages: Raw[];
  permissions: Raw[];
};

function isObject(value: unknown): value is Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectValue(value: unknown): Raw | undefined {
  return isObject(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function timestampToIso(value: unknown): string | undefined {
  const n = numberValue(value);
  if (n !== undefined) return new Date(n).toISOString();
  const s = stringValue(value);
  if (s !== undefined) {
    const ms = Number(s);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return undefined;
}

async function readJsonFile(path: string): Promise<Raw | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parsedJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function sourceFor(raw: Raw, rawType: string, schemaVersion: string | undefined): Entry["source"] {
  const redacted = redactValue(raw);
  return {
    agent: "opencode",
    original_type: rawType,
    ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
    raw: enforceSourceRawSize(redacted).value as Raw,
  };
}

function metaFor(rawType: string): Entry["meta"] {
  return { "dev.opencode.raw_type": rawType };
}

function sourceId(raw: Raw, fallback: string): string {
  return stringValue(raw.id) ?? fallback;
}

function partTimestamp(part: Raw, message?: Raw): string {
  const time = objectValue(part.time);
  const messageTime = objectValue(message?.time);
  return (
    timestampToIso(time?.created) ??
    timestampToIso(time?.updated) ??
    timestampToIso(part.time_created) ??
    timestampToIso(part.time_updated) ??
    timestampToIso(messageTime?.created) ??
    timestampToIso(messageTime?.updated) ??
    timestampToIso(message?.time_created) ??
    timestampToIso(message?.time_updated) ??
    new Date(0).toISOString()
  );
}

async function pathExists(path: string | undefined): Promise<boolean> {
  if (path === undefined) return false;
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(path: string | undefined): Promise<boolean> {
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
      const id = stringValue(raw.id) ?? file.name.replace(/\.json$/, "");
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
    if (raw !== undefined) out.push(raw);
  }
  return out;
}

async function loadFileSession(path: string): Promise<LoadedSession> {
  const session = await readJsonFile(path);
  if (session === undefined) throw new Error(`OpenCode session JSON unreadable: ${path}`);
  const id = stringValue(session.id) ?? path.replace(/^.*\//, "").replace(/\.json$/, "");
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
  const todos = (Array.isArray(todoRaw) ? todoRaw : [todoRaw]).filter(isObject) as OpenCodeTodo[];
  const enrichment = loadDbMetadataForFileSession(id);
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

function parsedJsonObject(text: unknown): Raw {
  if (isObject(text)) return text;
  if (typeof text !== "string") return {};
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

function loadDbMetadataForFileSession(id: string): {
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

function loadDbSession(pathWithFragment: string): LoadedSession {
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
    const todos = db
      .query("SELECT * FROM todo WHERE session_id = $id ORDER BY position")
      .all({ $id: id })
      .filter(isObject) as OpenCodeTodo[];
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

async function discoveredSummaries(opts: DetectOptions = {}): Promise<OpenCodeSessionSummary[]> {
  const fileRefs = await fileSessionSummaries(opencodeStorageDir());
  const fileIds = new Set(fileRefs.map((ref) => ref.id));
  const dbRefs = sqliteSessionSummaries(opencodeDbPath()).filter((ref) => !fileIds.has(ref.id));
  const effectiveCwd = opts.cwd ?? process.cwd();
  return [...fileRefs, ...dbRefs]
    .filter((ref) => opts.allCwds === true || ref.cwd === effectiveCwd)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.id.localeCompare(b.id));
}

function headerFromLoaded(loaded: LoadedSession, ref: SessionRef): Header {
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

function worktreeFromProject(
  project: Raw | undefined,
): NonNullable<NonNullable<Header["vcs"]>["worktree"]> | undefined {
  const worktreePath = stringValue(project?.worktree);
  if (worktreePath === undefined) return undefined;
  return {
    name: stringValue(project?.name) ?? basename(worktreePath),
    path: worktreePath,
  };
}

function usageFrom(
  raw: Raw,
): NonNullable<Extract<Entry, { type?: "agent_message" }>["payload"]>["usage"] | undefined {
  const tokens = objectValue(raw.tokens);
  const cache = objectValue(tokens?.cache);
  const input = numberValue(tokens?.input) ?? numberValue(raw.tokens_input);
  const output = numberValue(tokens?.output) ?? numberValue(raw.tokens_output);
  if (input === undefined || output === undefined) return undefined;
  return {
    input_tokens: input,
    output_tokens: output,
    ...((numberValue(tokens?.reasoning) ?? numberValue(raw.tokens_reasoning) !== undefined)
      ? { reasoning_tokens: numberValue(tokens?.reasoning) ?? numberValue(raw.tokens_reasoning) }
      : {}),
    ...((numberValue(cache?.read) ?? numberValue(raw.tokens_cache_read) !== undefined)
      ? { cache_read_tokens: numberValue(cache?.read) ?? numberValue(raw.tokens_cache_read) }
      : {}),
    ...((numberValue(cache?.write) ?? numberValue(raw.tokens_cache_write) !== undefined)
      ? { cache_creation_tokens: numberValue(cache?.write) ?? numberValue(raw.tokens_cache_write) }
      : {}),
  };
}

function tokenTotalsFromSession(session: Raw): Raw | undefined {
  const input = numberValue(session.tokens_input);
  const output = numberValue(session.tokens_output);
  const reasoning = numberValue(session.tokens_reasoning);
  const cacheRead = numberValue(session.tokens_cache_read);
  const cacheWrite = numberValue(session.tokens_cache_write);
  if (
    input === undefined &&
    output === undefined &&
    reasoning === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined
  ) {
    return undefined;
  }
  return {
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    ...(reasoning !== undefined ? { reasoning_tokens: reasoning } : {}),
    ...(cacheRead !== undefined ? { cache_read_tokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cache_creation_tokens: cacheWrite } : {}),
  };
}

function modelName(value: unknown): string | undefined {
  const obj = objectValue(value);
  if (obj !== undefined) {
    const id = stringValue(obj.id) ?? stringValue(obj.modelID);
    const provider = stringValue(obj.providerID) ?? stringValue(obj.provider);
    if (id !== undefined && provider !== undefined) return `${provider}/${id}`;
    return id;
  }
  return stringValue(value);
}

function attachmentFrom(raw: Raw): Attachment {
  const mime = stringValue(raw.mime) ?? stringValue(raw.mediaType);
  const url = stringValue(raw.url) ?? stringValue(raw.uri);
  const filename = stringValue(raw.filename) ?? stringValue(raw.name);
  return {
    kind: mime?.startsWith("image/") ? "image" : mime !== undefined ? "file" : "other",
    ...(mime !== undefined ? { media_type: mime } : {}),
    ...(url !== undefined && /^(https:|file:|sha256:)/.test(url) ? { uri: url } : {}),
    ...(filename !== undefined ? { name: filename } : {}),
  };
}

function attachmentsFrom(value: unknown): Attachment[] {
  const rawItems = arrayValue(value);
  if (rawItems === undefined) return [];
  return rawItems.flatMap((item) => {
    const raw = objectValue(item);
    return raw === undefined ? [] : [attachmentFrom(raw)];
  });
}

function compactDiffs(value: unknown): Raw[] | undefined {
  const diffs = arrayValue(value);
  if (diffs === undefined) return undefined;
  return diffs.flatMap((diff) => {
    const obj = objectValue(diff);
    if (obj === undefined) return [];
    return [
      {
        ...(stringValue(obj.file) !== undefined ? { file: stringValue(obj.file) } : {}),
        ...(numberValue(obj.additions) !== undefined
          ? { additions: numberValue(obj.additions) }
          : {}),
        ...(numberValue(obj.deletions) !== undefined
          ? { deletions: numberValue(obj.deletions) }
          : {}),
        ...(stringValue(obj.status) !== undefined ? { status: stringValue(obj.status) } : {}),
      },
    ];
  });
}

function todoItemsFrom(
  value: unknown,
): { id: string; content: string; status: ReturnType<typeof todoStatus> }[] {
  const todos = arrayValue(value);
  if (todos === undefined) return [];
  return todos.flatMap((todo, index) => {
    const obj = objectValue(todo);
    if (obj === undefined) return [];
    const content = stringValue(obj.content);
    if (content === undefined) return [];
    return [
      {
        id: stringValue(obj.id) ?? String(numberValue(obj.position) ?? index + 1),
        content,
        status: todoStatus(obj.status),
      },
    ];
  });
}

function mapTool(toolName: string, args: Raw): { tool: ToolKind; args: Raw } {
  switch (toolName) {
    case "read": {
      const path =
        stringValue(args.filePath) ?? stringValue(args.file_path) ?? stringValue(args.path);
      const offset = numberValue(args.offset);
      const limit = numberValue(args.limit);
      return {
        tool: "file_read",
        args: {
          ...(path !== undefined ? { path } : {}),
          ...(offset !== undefined && limit !== undefined
            ? { range: [offset, offset + limit] }
            : {}),
        },
      };
    }
    case "write": {
      const path = stringValue(args.filePath) ?? stringValue(args.path);
      return {
        tool: "file_write",
        args: {
          ...(path !== undefined ? { path } : {}),
          ...(stringValue(args.content) !== undefined
            ? { content: stringValue(args.content) }
            : {}),
        },
      };
    }
    case "edit": {
      const path = stringValue(args.filePath) ?? stringValue(args.path);
      const oldString = stringValue(args.oldString) ?? stringValue(args.old_string) ?? "";
      const newString = stringValue(args.newString) ?? stringValue(args.new_string) ?? "";
      const diff =
        path === undefined
          ? undefined
          : `--- a/${path}\n+++ b/${path}\n@@\n-${oldString}\n+${newString}`;
      return {
        tool: "file_edit",
        args: { ...(path !== undefined ? { path } : {}), ...(diff !== undefined ? { diff } : {}) },
      };
    }
    case "bash": {
      return {
        tool: "shell_command",
        args: {
          ...(stringValue(args.command) !== undefined
            ? { command: stringValue(args.command) }
            : {}),
          ...(stringValue(args.workdir) !== undefined ? { cwd: stringValue(args.workdir) } : {}),
          ...(numberValue(args.timeout) !== undefined
            ? { timeout: numberValue(args.timeout) }
            : {}),
        },
      };
    }
    case "background_output": {
      const commandId =
        stringValue(args.commandID) ?? stringValue(args.command_id) ?? stringValue(args.id);
      return {
        tool: "shell_output",
        args: { ...(commandId !== undefined ? { command_id: commandId } : {}) },
      };
    }
    case "grep":
      return {
        tool: "file_search",
        args: {
          query: stringValue(args.pattern) ?? "",
          ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
          ...(stringValue(args.include) !== undefined ? { glob: stringValue(args.include) } : {}),
        },
      };
    case "glob": {
      return {
        tool: "file_search",
        args: {
          query: stringValue(args.pattern) ?? "",
          ...(stringValue(args.path) !== undefined ? { path: stringValue(args.path) } : {}),
        },
      };
    }
    case "list": {
      const path = stringValue(args.path) ?? ".";
      return { tool: "shell_command", args: { command: `ls -- ${JSON.stringify(path)}` } };
    }
    case "webfetch": {
      return {
        tool: "web_fetch",
        args: {
          ...(stringValue(args.url) !== undefined ? { url: stringValue(args.url) } : { url: "" }),
        },
      };
    }
    case "task": {
      return {
        tool: "subagent_invoke",
        args: {
          task: stringValue(args.prompt) ?? stringValue(args.description) ?? "",
          ...(stringValue(args.subagent_type) !== undefined
            ? { agent_type: stringValue(args.subagent_type) }
            : {}),
        },
      };
    }
    default:
      if (/^[a-z0-9-]+_[a-z0-9][a-z0-9_-]*$/i.test(toolName)) {
        const [server, ...toolParts] = toolName.split("_");
        return {
          tool: "mcp_call",
          args: { server: server!, tool: toolParts.join("-"), args },
        };
      }
      return { tool: "other", args: { name: toolName, args } };
  }
}

function todoStatus(
  status: unknown,
): "pending" | "in_progress" | "completed" | "cancelled" | "blocked" {
  if (
    status === "in_progress" ||
    status === "completed" ||
    status === "cancelled" ||
    status === "blocked"
  )
    return status;
  return "pending";
}

function entriesFromLoaded(loaded: LoadedSession, header: Header): Entry[] {
  const entries: Entry[] = [];
  const openCalls = new Map<string, string>();
  let parentId: string | undefined;
  const schemaVersion = SOURCE_SCHEMA_VERSION;
  const sessionModel = header.agent.model_default;

  function push(draft: Omit<Entry, "id" | "parent_id">, sourceKey: string): Entry {
    const id = deriveSynthesizedEntryId(OPENCODE_ENTRY_ID_NAMESPACE, [
      header.session_uid ?? header.id,
      sourceKey,
      String(draft.type),
    ]);
    const entry = {
      ...draft,
      id,
      ...(parentId !== undefined ? { parent_id: parentId } : {}),
    } as Entry;
    entries.push(entry);
    parentId = id;
    return entry;
  }

  function pushMetadata(field: string, value: unknown, sourceKey: string): void {
    if (value === undefined || value === null) return;
    push(
      {
        type: "session_metadata_update",
        ts: header.ts,
        payload: { field, value, reason: "external" },
        source: sourceFor(loaded.session, `session.${sourceKey}`, schemaVersion),
        meta: metaFor(`session.${sourceKey}`),
      },
      `session:${sourceKey}`,
    );
  }

  const title = stringValue(loaded.session.title);
  if (title !== undefined) pushMetadata("name", title, "title");
  if (header.agent.model_default !== undefined) {
    pushMetadata("agent.model_default", header.agent.model_default, "model");
  }
  pushMetadata("x-opencode/share_url", stringValue(loaded.session.share_url), "share_url");
  pushMetadata("x-opencode/token_totals", tokenTotalsFromSession(loaded.session), "token_totals");
  const summaryDiffs = compactDiffs(loaded.session.summary_diffs);
  const summary = {
    ...(numberValue(loaded.session.summary_additions) !== undefined
      ? { additions: numberValue(loaded.session.summary_additions) }
      : {}),
    ...(numberValue(loaded.session.summary_deletions) !== undefined
      ? { deletions: numberValue(loaded.session.summary_deletions) }
      : {}),
    ...(numberValue(loaded.session.summary_files) !== undefined
      ? { files: numberValue(loaded.session.summary_files) }
      : {}),
    ...(summaryDiffs !== undefined ? { diffs: summaryDiffs } : {}),
  };
  if (Object.keys(summary).length > 0)
    pushMetadata("x-opencode/session_summary", summary, "summary");
  pushMetadata("x-opencode/revert", objectValue(loaded.session.revert), "revert");
  pushMetadata("x-opencode/session_permission", loaded.session.permission, "permission");
  const state = {
    ...(timestampToIso(loaded.session.time_archived) !== undefined
      ? { archived_at: timestampToIso(loaded.session.time_archived) }
      : {}),
    ...(timestampToIso(loaded.session.time_compacting) !== undefined
      ? { compacting_at: timestampToIso(loaded.session.time_compacting) }
      : {}),
    ...(stringValue(loaded.session.agent) !== undefined
      ? { agent: stringValue(loaded.session.agent) }
      : {}),
    ...(numberValue(loaded.session.cost) !== undefined
      ? { cost: numberValue(loaded.session.cost) }
      : {}),
    ...(objectValue(loaded.session.metadata) !== undefined
      ? { metadata: objectValue(loaded.session.metadata) }
      : {}),
  };
  if (Object.keys(state).length > 0) pushMetadata("x-opencode/session_state", state, "state");
  const projectWorktree = header.vcs?.worktree ?? worktreeFromProject(loaded.project);
  if (projectWorktree !== undefined) {
    push(
      {
        type: "session_metadata_update",
        ts: header.ts,
        payload: { field: "vcs.worktree", value: projectWorktree, reason: "runtime_inferred" },
        source: sourceFor(loaded.project ?? loaded.session, "project.worktree", schemaVersion),
        meta: metaFor("project.worktree"),
      },
      "project:worktree",
    );
  }

  for (const permission of loaded.permissions) {
    push(
      {
        type: "system_event",
        ts: partTimestamp(permission),
        payload: {
          kind: "x-opencode/permission_ruleset",
          data: {
            project_id: stringValue(permission.project_id),
            rules: permission.data,
          },
        },
        source: sourceFor(permission, "permission", schemaVersion),
        meta: metaFor("permission"),
      },
      sourceId(permission, `permission:${entries.length}`),
    );
  }

  for (const message of loaded.messages) {
    const role = stringValue(message.role);
    const messageParts = loaded.partsByMessage.get(message.id) ?? [];
    const messageAttachments = messageParts
      .filter((part) => stringValue(part.type) === "file")
      .map(attachmentFrom);
    for (const part of messageParts) {
      const type = stringValue(part.type);
      if (type === "file") continue;
      const rawType = `part.${type ?? "unknown"}`;
      const base = {
        ts: partTimestamp(part, message),
        source: sourceFor(part, rawType, schemaVersion),
        meta: metaFor(rawType),
      };
      if (type === "text") {
        const text = stringValue(part.text);
        if (text === undefined) continue;
        if (role === "user") {
          push(
            {
              ...base,
              type: "user_message",
              payload: {
                text,
                ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
              },
            },
            part.id,
          );
        } else {
          const model = stringValue(message.modelID) ?? sessionModel;
          const usage = usageFrom(part);
          push(
            {
              ...base,
              type: "agent_message",
              payload: {
                text,
                ...(model !== undefined ? { model } : {}),
                ...(usage !== undefined ? { usage } : {}),
                ...(messageAttachments.length > 0 ? { attachments: messageAttachments } : {}),
              },
            },
            part.id,
          );
        }
        continue;
      }
      if (type === "reasoning") {
        const text =
          stringValue(part.text) ??
          (part.encrypted === true || part.encryptedReasoning === true
            ? "[encrypted reasoning]"
            : undefined);
        if (text === undefined) continue;
        push(
          {
            ...base,
            type: "agent_thinking",
            payload: { text, ...(sessionModel !== undefined ? { model: sessionModel } : {}) },
          },
          part.id,
        );
        continue;
      }
      if (type === "tool") {
        const callID = stringValue(part.callID) ?? stringValue(part.call_id) ?? part.id;
        const state = objectValue(part.state) ?? part;
        const input = objectValue(state.input) ?? objectValue(part.input) ?? {};
        const name =
          stringValue(part.tool) ?? stringValue(part.name) ?? stringValue(state.tool) ?? "unknown";
        const toolRawType = `tool.${name}`;
        const toolBase = {
          ...base,
          source: sourceFor(part, toolRawType, schemaVersion),
          meta: metaFor(toolRawType),
        };
        if (name === "todowrite") {
          const items = todoItemsFrom(input.todos);
          if (items.length > 0) {
            push(
              {
                ...toolBase,
                type: "task_plan_update",
                payload: { items },
              },
              `${part.id}:todos`,
            );
            continue;
          }
        }
        if (name === "lsp_diagnostics") {
          push(
            {
              ...toolBase,
              type: "system_event",
              payload: {
                kind: "x-opencode/diagnostic",
                data: { tool: name, input, output: state.output },
              },
            },
            `${part.id}:diagnostic`,
          );
          continue;
        }
        const mapped = mapTool(name, input);
        const call = push(
          {
            ...toolBase,
            type: "tool_call",
            payload: mapped,
            semantic: { call_id: callID, tool_kind: mapped.tool },
          },
          `${part.id}:call`,
        );
        const status = stringValue(state.status) ?? stringValue(part.status);
        if (status === "completed" || status === "error" || status === "failed") {
          const ok = status === "completed";
          push(
            {
              ...base,
              source: toolBase.source,
              meta: toolBase.meta,
              type: "tool_result",
              payload: {
                for_id: call.id,
                ok,
                ...(stringValue(state.output) !== undefined
                  ? { output: stringValue(state.output) }
                  : {}),
                ...(stringValue(state.error) !== undefined
                  ? { error: stringValue(state.error) }
                  : {}),
                ...(attachmentsFrom(state.attachments).length > 0
                  ? { attachments: attachmentsFrom(state.attachments) }
                  : {}),
                ...(stringValue(state.title) !== undefined ||
                objectValue(state.metadata) !== undefined ||
                objectValue(state.time) !== undefined
                  ? {
                      meta: {
                        "x-opencode/tool": {
                          ...(stringValue(state.title) !== undefined
                            ? { title: stringValue(state.title) }
                            : {}),
                          ...(objectValue(state.metadata) !== undefined
                            ? { metadata: objectValue(state.metadata) }
                            : {}),
                          ...(objectValue(state.time) !== undefined
                            ? { time: objectValue(state.time) }
                            : {}),
                        },
                      },
                    }
                  : {}),
              },
              semantic: { call_id: callID, tool_kind: mapped.tool },
            },
            `${part.id}:result`,
          );
        } else if (status === "cancelled" || status === "canceled") {
          push(
            {
              ...base,
              source: toolBase.source,
              meta: toolBase.meta,
              type: "tool_call_aborted",
              payload: { scope: "tool_call", for_id: call.id, reason: "user_interrupt" },
              semantic: { call_id: callID, tool_kind: mapped.tool },
            },
            `${part.id}:aborted`,
          );
        } else {
          openCalls.set(callID, call.id);
        }
        continue;
      }
      if (type === "subtask") {
        const prompt = stringValue(part.prompt) ?? stringValue(part.description);
        if (prompt !== undefined) {
          push(
            {
              ...base,
              type: "tool_call",
              payload: {
                tool: "subagent_invoke",
                args: {
                  task: prompt,
                  ...(stringValue(part.agent) !== undefined
                    ? { agent_type: stringValue(part.agent) }
                    : {}),
                },
              },
              semantic: { call_id: part.id, tool_kind: "subagent_invoke" },
            },
            part.id,
          );
        } else {
          push(
            {
              ...base,
              type: "system_event",
              payload: { kind: "x-opencode/subtask", data: { ...part } },
            },
            part.id,
          );
        }
        continue;
      }
      if (type === "compaction") {
        const summary = stringValue(part.summary) ?? stringValue(part.text);
        if (summary !== undefined) {
          push(
            { ...base, type: "context_compact", payload: { summary, trigger: "auto" } },
            part.id,
          );
        } else {
          push(
            {
              ...base,
              type: "system_event",
              payload: { kind: "x-opencode/compaction", data: { ...part } },
            },
            part.id,
          );
        }
        continue;
      }
      if (type === "step-start" || type === "step-finish") {
        push(
          {
            ...base,
            type: "system_event",
            payload: { kind: type === "step-start" ? "turn_start" : "turn_end", data: { ...part } },
          },
          part.id,
        );
        continue;
      }
      if (type === "patch") {
        push(
          {
            ...base,
            type: "system_event",
            payload: {
              kind: "x-opencode/patch",
              data: {
                ...(stringValue(part.hash) !== undefined ? { hash: stringValue(part.hash) } : {}),
                ...(arrayValue(part.files) !== undefined ? { files: arrayValue(part.files) } : {}),
              },
            },
          },
          part.id,
        );
        continue;
      }
      if (type === "snapshot") {
        push(
          {
            ...base,
            type: "system_event",
            payload: {
              kind: "x-opencode/snapshot",
              data: { snapshot: stringValue(part.snapshot) },
            },
          },
          part.id,
        );
        continue;
      }
      if (type === "agent") {
        push(
          {
            ...base,
            type: "system_event",
            payload: { kind: "x-opencode/agent", data: { name: stringValue(part.name) } },
          },
          part.id,
        );
        continue;
      }
      if (type === "retry") {
        push(
          {
            ...base,
            type: "system_event",
            payload: {
              kind: "x-opencode/retry",
              data: {
                ...(numberValue(part.attempt) !== undefined
                  ? { attempt: numberValue(part.attempt) }
                  : {}),
                ...(part.error !== undefined ? { error: part.error } : {}),
              },
            },
          },
          part.id,
        );
        continue;
      }
      if (type === undefined || !KNOWN_PART_TYPES.has(type)) {
        push(
          {
            ...base,
            type: "system_event",
            payload: { kind: "x-opencode/unknown_record", data: { raw: { ...part } } },
          },
          part.id,
        );
        continue;
      }
      push(
        {
          ...base,
          type: "system_event",
          payload: { kind: `x-opencode/${type ?? "unknown"}`, data: { ...part } },
        },
        part.id,
      );
    }
  }

  if (loaded.todos.length > 0) {
    const first = loaded.todos[0]!;
    const items = loaded.todos.map((todo, index) => ({
      id: String(numberValue(todo.position) ?? index + 1),
      content: stringValue(todo.content) ?? "",
      status: todoStatus(todo.status),
    }));
    push(
      {
        type: "task_plan_update",
        ts: partTimestamp(first),
        payload: { items },
        source: sourceFor({ todos: loaded.todos }, "todo", schemaVersion),
        meta: metaFor("todo"),
      },
      "todo",
    );
  }

  for (const record of loaded.sessionMessages) {
    const type = stringValue(record.type);
    const rawType = `session_message.${type ?? "unknown"}`;
    if (type === "model-switched") {
      const toModel =
        stringValue(record.to) ?? stringValue(record.to_model) ?? stringValue(record.model);
      if (toModel !== undefined) {
        push(
          {
            type: "model_change",
            ts: partTimestamp(record),
            payload: {
              to_model: toModel,
              ...(stringValue(record.from) !== undefined
                ? { from_model: stringValue(record.from) }
                : {}),
              ...(stringValue(record.provider) !== undefined
                ? { to_provider: stringValue(record.provider) }
                : {}),
              trigger: "external",
            },
            source: sourceFor(record, rawType, schemaVersion),
            meta: metaFor(rawType),
          },
          sourceId(record, rawType),
        );
        continue;
      }
    }
    push(
      {
        type: "system_event",
        ts: partTimestamp(record),
        payload: { kind: `x-opencode/${type ?? "session_message"}`, data: { ...record } },
        source: sourceFor(record, rawType, schemaVersion),
        meta: metaFor(rawType),
      },
      sourceId(record, rawType),
    );
  }

  if (openCalls.size > 0) {
    push(
      {
        type: "session_terminated",
        ts: entries.at(-1)?.ts ?? header.ts,
        payload: { reason: "eof_with_open_tool_calls", open_call_ids: [...openCalls.values()] },
        source: { agent: "opencode", synthesized: true },
        meta: metaFor("session_terminated.eof_with_open_tool_calls"),
      },
      "session-terminated",
    );
  }

  return entries;
}

async function stampTrailFile(trail: TrailFile): Promise<TrailFile> {
  const records = [
    ...(trail.envelope !== undefined ? [trail.envelope] : []),
    ...trail.groups.flatMap((group) => [group.header, ...group.entries]),
  ];
  const parsed = await parseJsonlString(
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  stampTrail(parsed);
  const values = parsed.map((record) => record.value);
  const envelope = values[0] as TrailFile["envelope"];
  const header = values[1] as Header;
  const entries = values.slice(2) as Entry[];
  return { envelope, groups: [{ header, entries }] };
}

async function inspectSourceHealth(): Promise<AdapterSourceHealth> {
  const dataDir = opencodeDataDir();
  const storageDir = opencodeStorageDir();
  const dbPath = opencodeDbPath();
  const storagePresent = await dirExists(storageDir);
  const dbPresent = await pathExists(dbPath);
  const present = storagePresent || dbPresent;
  const sessionCount = present ? (await discoveredSummaries({ allCwds: true })).length : 0;
  const versions = new Set(
    (await discoveredSummaries({ allCwds: true }))
      .map((session) => session.version)
      .filter((version): version is string => version !== undefined),
  );
  const [sourceVersion] = versions;
  return {
    adapter: "opencode",
    path: dataDir ?? dbPath ?? null,
    present,
    readable: present,
    sessionCount,
    sourceVersion: versions.size === 1 ? (sourceVersion ?? null) : null,
    warnings: [],
  };
}

export const opencodeAdapter: TrailAdapter = {
  name: "opencode",

  async detectSessions(_opts?: DetectOptions): Promise<SessionRef[]> {
    return (await discoveredSummaries(_opts)).map((session) => ({
      id: session.id,
      adapter: "opencode",
      cwd: session.cwd,
      modifiedAt: session.modifiedAt,
      path: session.path,
    }));
  },

  async parseSession(ref: SessionRef): Promise<TrailFile> {
    if (ref.path === undefined) throw new Error("OpenCode parseSession requires ref.path");
    const loaded = ref.path.includes("#")
      ? loadDbSession(ref.path)
      : await loadFileSession(ref.path);
    const header = headerFromLoaded(loaded, ref);
    const vcs = header.cwd === undefined ? undefined : await readGitVcs(header.cwd);
    if (vcs !== undefined) {
      const projectWorktree = worktreeFromProject(loaded.project);
      header.vcs = {
        ...vcs,
        ...(vcs.worktree === undefined && projectWorktree !== undefined
          ? { worktree: projectWorktree }
          : {}),
      };
    }
    const entries = entriesFromLoaded(loaded, header);
    applyParseFidelity(header, entries);
    const group = { header, entries };
    return stampTrailFile({
      envelope: buildTrailEnvelope({
        producer: PRODUCER,
        groups: [group],
        name: stringValue(loaded.session.title) ?? stringValue(loaded.session.slug),
      }),
      groups: [group],
    });
  },

  async isAvailable(): Promise<boolean> {
    const health = await inspectSourceHealth();
    return health.present && health.readable;
  },

  async sourceVersion(): Promise<string | null> {
    return (await inspectSourceHealth()).sourceVersion;
  },

  async sourceHealth(): Promise<AdapterSourceHealth> {
    return inspectSourceHealth();
  },
};
