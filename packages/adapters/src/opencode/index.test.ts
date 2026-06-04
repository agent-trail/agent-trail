import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSourceRecord } from "@agent-trail/adapter-kit";
import { opencodeAdapter, trailRecords, validateAdapterTrail } from "../index.ts";

let prevHome: string | undefined;
let prevUserProfile: string | undefined;
let prevXdgDataHome: string | undefined;
let prevOpencodeDataDir: string | undefined;
let prevOpencodeDb: string | undefined;
let prevCwd: string;
let tmpHome: string;
let dataDir: string;
let tmpCwd: string;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevXdgDataHome = process.env.XDG_DATA_HOME;
  prevOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
  prevOpencodeDb = process.env.OPENCODE_DB;
  prevCwd = process.cwd();
  tmpHome = mkdtempSync(join(tmpdir(), "opencode-adapter-home-"));
  dataDir = mkdtempSync(join(tmpdir(), "opencode-adapter-data-"));
  tmpCwd = mkdtempSync(join(tmpdir(), "opencode-adapter-cwd-"));
  process.env.HOME = tmpHome;
  delete process.env.USERPROFILE;
  delete process.env.XDG_DATA_HOME;
  process.env.OPENCODE_DATA_DIR = dataDir;
  delete process.env.OPENCODE_DB;
  process.chdir(tmpCwd);
  tmpCwd = process.cwd();
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevUserProfile;
  if (prevXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = prevXdgDataHome;
  if (prevOpencodeDataDir === undefined) delete process.env.OPENCODE_DATA_DIR;
  else process.env.OPENCODE_DATA_DIR = prevOpencodeDataDir;
  if (prevOpencodeDb === undefined) delete process.env.OPENCODE_DB;
  else process.env.OPENCODE_DB = prevOpencodeDb;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(tmpCwd, { recursive: true, force: true });
});

test("opencodeAdapter has name 'opencode'", () => {
  expect(opencodeAdapter.name).toBe("opencode");
});

test("opencodeAdapter reports unavailable when no storage exists", async () => {
  rmSync(dataDir, { recursive: true, force: true });
  expect(await opencodeAdapter.isAvailable()).toBe(false);
  expect(await opencodeAdapter.detectSessions({ allCwds: true })).toEqual([]);
  expect(await opencodeAdapter.sourceVersion()).toBe(null);
  expect(await opencodeAdapter.sourceHealth()).toEqual({
    adapter: "opencode",
    path: dataDir,
    present: false,
    readable: false,
    sessionCount: 0,
    sourceVersion: null,
    warnings: [],
  });
});

test("opencodeAdapter reports available when file storage exists", async () => {
  mkdirSync(join(dataDir, "storage", "session"), { recursive: true });
  expect(await opencodeAdapter.isAvailable()).toBe(true);
});

test("OpenCode source schema recognizes every upstream-known part type", () => {
  const partTypes = [
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
  ];
  for (const partType of partTypes) {
    expect(validateSourceRecord("opencode", "v1", { type: "part", part_type: partType })).toEqual(
      [],
    );
  }
  expect(validateSourceRecord("opencode", "v1", { type: "part", part_type: "future" })).not.toEqual(
    [],
  );
});

function seedFileSession(opts: {
  id: string;
  projectID?: string;
  directory: string;
  title?: string;
  version?: string;
  created?: number;
  updated?: number;
}): string {
  const projectID = opts.projectID ?? "project-a";
  const dir = join(dataDir, "storage", "session", projectID);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${opts.id}.json`);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        id: opts.id,
        version: opts.version ?? "1.0.153",
        projectID,
        directory: opts.directory,
        title: opts.title ?? "Synthetic OpenCode session",
        time: {
          created: opts.created ?? 1766258473000,
          updated: opts.updated ?? 1766258479000,
        },
      },
      null,
      2,
    )}\n`,
  );
  const mtime = new Date(opts.updated ?? 1766258479000);
  utimesSync(path, mtime, mtime);
  return path;
}

function seedFileMessage(opts: {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  modelID?: string;
  providerID?: string;
  created?: number;
  updated?: number;
}): string {
  const dir = join(dataDir, "storage", "message", opts.sessionID);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${opts.id}.json`);
  writeFileSync(
    path,
    `${JSON.stringify({
      id: opts.id,
      sessionID: opts.sessionID,
      role: opts.role,
      modelID: opts.modelID,
      providerID: opts.providerID,
      time: {
        created: opts.created ?? 1766258474000,
        updated: opts.updated ?? 1766258474000,
      },
    })}\n`,
  );
  return path;
}

function seedFilePart(part: Record<string, unknown> & { id: string; messageID: string }): string {
  const dir = join(dataDir, "storage", "part", part.messageID);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${part.id}.json`);
  writeFileSync(path, `${JSON.stringify(part, null, 2)}\n`);
  return path;
}

function seedFileTodo(opts: {
  sessionID: string;
  content: string;
  status: string;
  priority?: string;
  position?: number;
}): string {
  const dir = join(dataDir, "storage", "todo");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${opts.sessionID}.json`);
  writeFileSync(
    path,
    `${JSON.stringify([
      {
        sessionID: opts.sessionID,
        content: opts.content,
        status: opts.status,
        priority: opts.priority ?? "medium",
        position: opts.position ?? 1,
        time: { created: 1766258475000, updated: 1766258475000 },
      },
    ])}\n`,
  );
  return path;
}

function seedSqliteSession(opts: {
  id: string;
  directory: string;
  title?: string;
  version?: string;
  created?: number;
  updated?: number;
}): string {
  const path = join(dataDir, "opencode.db");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE project (
      id text PRIMARY KEY,
      directory text NOT NULL,
      worktree text,
      vcs text,
      name text,
      commands text,
      time_created integer NOT NULL,
      time_updated integer NOT NULL
    );
    CREATE TABLE session (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      parent_id text,
      slug text NOT NULL,
      directory text NOT NULL,
      path text,
      title text NOT NULL,
      version text NOT NULL,
      share_url text,
      summary_additions integer,
      summary_deletions integer,
      summary_files integer,
      summary_diffs text,
      revert text,
      permission text,
      agent text,
      time_created integer NOT NULL,
      time_updated integer NOT NULL,
      time_compacting integer,
      time_archived integer,
      metadata text,
      model text,
      cost real DEFAULT 0 NOT NULL,
      tokens_input integer DEFAULT 0 NOT NULL,
      tokens_output integer DEFAULT 0 NOT NULL,
      tokens_reasoning integer DEFAULT 0 NOT NULL,
      tokens_cache_read integer DEFAULT 0 NOT NULL,
      tokens_cache_write integer DEFAULT 0 NOT NULL
    );
    CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE todo (session_id text NOT NULL, content text NOT NULL, status text NOT NULL, priority text NOT NULL, position integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL);
    CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE permission (project_id text PRIMARY KEY, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
  `);
  const created = opts.created ?? 1766258473000;
  const updated = opts.updated ?? 1766258479000;
  db.query(
    `INSERT INTO project (
      id, directory, worktree, vcs, name, commands, time_created, time_updated
    ) VALUES ($id, $directory, $directory, 'git', 'synthetic-project', '{"test":"bun test"}', $created, $updated)`,
  ).run({ $id: "project-db", $directory: opts.directory, $created: created, $updated: updated });
  db.query(
    `INSERT INTO session (
      id, project_id, slug, directory, title, version, time_created, time_updated, model
    ) VALUES ($id, 'project-db', 'synthetic', $directory, $title, $version, $created, $updated, '{"providerID":"anthropic","id":"claude-sonnet-4-5"}')`,
  ).run({
    $id: opts.id,
    $directory: opts.directory,
    $title: opts.title ?? "SQLite OpenCode session",
    $version: opts.version ?? "1.0.153",
    $created: created,
    $updated: updated,
  });
  db.close();
  return path;
}

function updateDbSessionMetadata(dbPath: string, sessionID: string): void {
  const db = new Database(dbPath);
  db.query(
    `UPDATE session SET
      share_url = 'https://opencode.ai/s/ses_meta',
      summary_additions = 7,
      summary_deletions = 2,
      summary_files = 1,
      summary_diffs = $summaryDiffs,
      revert = $revert,
      permission = $permission,
      agent = 'build',
      time_compacting = 1766258476500,
      time_archived = 1766258479500,
      metadata = $metadata,
      cost = 1.25
    WHERE id = $id`,
  ).run({
    $id: sessionID,
    $summaryDiffs: JSON.stringify([
      { file: "src/app.ts", before: "old", after: "new", additions: 7, deletions: 2 },
    ]),
    $revert: JSON.stringify({
      messageID: "msg_meta",
      snapshot: "snap_123",
      diff: "@@\n-old\n+new",
    }),
    $permission: JSON.stringify([{ permission: "edit", pattern: "*.ts", action: "ask" }]),
    $metadata: JSON.stringify({ branch: "main" }),
  });
  db.query(
    "INSERT INTO permission (project_id, time_created, time_updated, data) VALUES ('project-db', 1766258473600, 1766258473600, $data)",
  ).run({
    $data: JSON.stringify([{ permission: "bash", pattern: "npm *", action: "ask" }]),
  });
  db.close();
}

function insertDbMessage(
  dbPath: string,
  opts: {
    id: string;
    sessionID: string;
    role: "user" | "assistant";
    modelID?: string;
    providerID?: string;
    created: number;
  },
): void {
  const db = new Database(dbPath);
  db.query(
    "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ($id, $session, $created, $created, $data)",
  ).run({
    $id: opts.id,
    $session: opts.sessionID,
    $created: opts.created,
    $data: JSON.stringify({
      id: opts.id,
      sessionID: opts.sessionID,
      role: opts.role,
      modelID: opts.modelID,
      providerID: opts.providerID,
    }),
  });
  db.close();
}

function insertDbPart(
  dbPath: string,
  part: Record<string, unknown> & { id: string; sessionID: string; messageID: string },
  created: number,
): void {
  const db = new Database(dbPath);
  db.query(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ($id, $message, $session, $created, $created, $data)",
  ).run({
    $id: part.id,
    $message: part.messageID,
    $session: part.sessionID,
    $created: created,
    $data: JSON.stringify(part),
  });
  db.close();
}

function insertDbSessionMessage(
  dbPath: string,
  opts: {
    id: string;
    sessionID: string;
    type: string;
    created: number;
    data: Record<string, unknown>;
  },
): void {
  const db = new Database(dbPath);
  db.query(
    "INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES ($id, $session, $type, $created, $created, $data)",
  ).run({
    $id: opts.id,
    $session: opts.sessionID,
    $type: opts.type,
    $created: opts.created,
    $data: JSON.stringify(opts.data),
  });
  db.close();
}

test("detectSessions() returns file-storage sessions matching cwd", async () => {
  const path = seedFileSession({ id: "ses_file", directory: "/work/project" });
  seedFileSession({ id: "ses_other", directory: "/work/other" });
  const refs = await opencodeAdapter.detectSessions({ cwd: "/work/project" });
  expect(refs).toEqual([
    {
      id: "ses_file",
      adapter: "opencode",
      cwd: "/work/project",
      modifiedAt: "2025-12-20T19:21:19.000Z",
      path,
    },
  ]);
});

test("detectSessions() defaults to process.cwd()", async () => {
  const path = seedFileSession({ id: "ses_here", directory: tmpCwd });
  seedFileSession({ id: "ses_elsewhere", directory: "/work/elsewhere" });
  const refs = await opencodeAdapter.detectSessions();
  expect(refs.map((ref) => ({ id: ref.id, path: ref.path }))).toEqual([{ id: "ses_here", path }]);
});

test("detectSessions({ allCwds:true }) returns file-storage sessions across projects", async () => {
  seedFileSession({ id: "ses_a", directory: "/work/a", updated: 1766258479000 });
  seedFileSession({
    id: "ses_b",
    projectID: "project-b",
    directory: "/work/b",
    updated: 1766258480000,
  });
  const refs = await opencodeAdapter.detectSessions({ allCwds: true });
  expect(refs.map((ref) => ({ id: ref.id, cwd: ref.cwd }))).toEqual([
    { id: "ses_b", cwd: "/work/b" },
    { id: "ses_a", cwd: "/work/a" },
  ]);
});

test("detectSessions() returns SQLite sessions with virtual paths", async () => {
  const dbPath = seedSqliteSession({ id: "ses_db", directory: "/work/db" });
  const refs = await opencodeAdapter.detectSessions({ cwd: "/work/db" });
  expect(refs).toEqual([
    {
      id: "ses_db",
      adapter: "opencode",
      cwd: "/work/db",
      modifiedAt: "2025-12-20T19:21:19.000Z",
      path: `${dbPath}#ses_db`,
    },
  ]);
});

test("detectSessions() prefers file storage when file and SQLite contain the same session id", async () => {
  const filePath = seedFileSession({ id: "ses_same", directory: "/work/file" });
  seedSqliteSession({ id: "ses_same", directory: "/work/db" });
  const refs = await opencodeAdapter.detectSessions({ allCwds: true });
  expect(refs).toHaveLength(1);
  expect(refs[0]).toMatchObject({ id: "ses_same", cwd: "/work/file", path: filePath });
});

test("parseSession() emits a valid finalized trail from file storage", async () => {
  const sessionPath = seedFileSession({
    id: "ses_parse",
    directory: "/work/parse",
    title: "Parse OpenCode",
    version: "1.0.153",
    created: 1766258473000,
    updated: 1766258485000,
  });
  seedFileMessage({ id: "msg_user", sessionID: "ses_parse", role: "user", created: 1766258474000 });
  seedFilePart({
    id: "prt_user",
    sessionID: "ses_parse",
    messageID: "msg_user",
    type: "text",
    text: "hello opencode",
    time: { created: 1766258474000, updated: 1766258474000 },
  });
  seedFileMessage({
    id: "msg_assistant",
    sessionID: "ses_parse",
    role: "assistant",
    modelID: "claude-sonnet-4-5",
    providerID: "anthropic",
    created: 1766258475000,
  });
  seedFilePart({
    id: "prt_reason",
    sessionID: "ses_parse",
    messageID: "msg_assistant",
    type: "reasoning",
    text: "Need inspect file.",
    time: { created: 1766258475000, updated: 1766258475000 },
  });
  seedFilePart({
    id: "prt_tool",
    sessionID: "ses_parse",
    messageID: "msg_assistant",
    type: "tool",
    callID: "call-read",
    tool: "read",
    state: {
      status: "completed",
      input: { filePath: "README.md", offset: 1, limit: 5 },
      output: "README contents",
    },
    time: { created: 1766258476000, updated: 1766258477000 },
  });
  seedFilePart({
    id: "prt_agent",
    sessionID: "ses_parse",
    messageID: "msg_assistant",
    type: "text",
    text: "Read complete.",
    time: { created: 1766258478000, updated: 1766258478000 },
  });
  seedFileTodo({ sessionID: "ses_parse", content: "Read README", status: "completed" });

  const trail = await opencodeAdapter.parseSession({
    id: "ses_parse",
    adapter: "opencode",
    path: sessionPath,
  });
  expect(trail.envelope?.type).toBe("trail");
  expect(trail.envelope?.name).toBe("Parse OpenCode");
  expect(trail.envelope?.producer).toMatch(/^@agent-trail\/adapters-opencode\//);
  expect(trail.envelope?.content_hash).toMatch(/^[0-9a-f]{64}$/);
  const group = trail.groups[0]!;
  expect(group.header.agent).toEqual({
    name: "opencode",
    version: "1.0.153",
    model_default: "claude-sonnet-4-5",
  });
  expect(group.header.cwd).toBe("/work/parse");
  expect(group.header.content_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(group.header.parse_fidelity).toEqual({ quarantined_count: 0 });
  expect(group.entries.map((entry) => entry.type)).toEqual([
    "session_metadata_update",
    "session_metadata_update",
    "user_message",
    "agent_thinking",
    "tool_call",
    "tool_result",
    "agent_message",
    "task_plan_update",
  ]);
  expect(group.entries[2]?.payload).toEqual({ text: "hello opencode" });
  expect(group.entries[4]?.payload).toEqual({
    tool: "file_read",
    args: { path: "README.md", range: [1, 6] },
  });
  expect(group.entries[5]?.payload).toMatchObject({
    ok: true,
    output: "README contents",
  });
  expect(group.entries[6]?.payload).toEqual({
    text: "Read complete.",
    model: "claude-sonnet-4-5",
  });
  expect(group.entries.every((entry) => entry.meta?.["dev.opencode.raw_type"] !== undefined)).toBe(
    true,
  );
  expect(group.entries.every((entry) => entry.source?.schema_version === "v1")).toBe(true);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(trailRecords(trail)[0]).toHaveProperty("content_hash");
});

test("parseSession() emits SQLite-backed lifecycle entries and EOF open-tool termination", async () => {
  const dbPath = seedSqliteSession({
    id: "ses_sql_parse",
    directory: "/work/sql",
    title: "SQLite Parse",
    version: "1.0.153",
  });
  insertDbMessage(dbPath, {
    id: "msg_sql",
    sessionID: "ses_sql_parse",
    role: "assistant",
    modelID: "claude-sonnet-4-5",
    created: 1766258474000,
  });
  insertDbPart(
    dbPath,
    {
      id: "prt_encrypted",
      sessionID: "ses_sql_parse",
      messageID: "msg_sql",
      type: "reasoning",
      encrypted: true,
    },
    1766258474000,
  );
  insertDbPart(
    dbPath,
    {
      id: "prt_compact",
      sessionID: "ses_sql_parse",
      messageID: "msg_sql",
      type: "compaction",
      summary: "Earlier context summarized.",
    },
    1766258475000,
  );
  insertDbPart(
    dbPath,
    {
      id: "prt_abort",
      sessionID: "ses_sql_parse",
      messageID: "msg_sql",
      type: "tool",
      callID: "call-abort",
      tool: "bash",
      state: { status: "cancelled", input: { command: "sleep 10" } },
    },
    1766258476000,
  );
  insertDbPart(
    dbPath,
    {
      id: "prt_open",
      sessionID: "ses_sql_parse",
      messageID: "msg_sql",
      type: "tool",
      callID: "call-open",
      tool: "bash",
      state: { status: "running", input: { command: "npm test" } },
    },
    1766258477000,
  );
  insertDbSessionMessage(dbPath, {
    id: "sm_model",
    sessionID: "ses_sql_parse",
    type: "model-switched",
    created: 1766258478000,
    data: { from: "claude-3-5", to: "claude-sonnet-4-5", provider: "anthropic" },
  });

  const trail = await opencodeAdapter.parseSession({
    id: "ses_sql_parse",
    adapter: "opencode",
    path: `${dbPath}#ses_sql_parse`,
  });
  const group = trail.groups[0]!;
  expect(group.entries.map((entry) => entry.type)).toEqual([
    "session_metadata_update",
    "session_metadata_update",
    "session_metadata_update",
    "session_metadata_update",
    "session_metadata_update",
    "agent_thinking",
    "context_compact",
    "tool_call",
    "tool_call_aborted",
    "tool_call",
    "model_change",
    "session_terminated",
  ]);
  expect(group.entries[5]?.payload).toEqual({
    text: "[encrypted reasoning]",
    model: "claude-sonnet-4-5",
  });
  expect(group.entries[6]?.payload).toEqual({
    summary: "Earlier context summarized.",
    trigger: "auto",
  });
  expect(group.entries.at(-1)?.payload).toMatchObject({
    reason: "eof_with_open_tool_calls",
  });
  expect(group.header.parse_fidelity).toEqual({
    quarantined_count: 0,
    termination_reason: "eof_with_open_tool_calls",
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});

test("parseSession() quarantines source-schema drift as unknown_record", async () => {
  const sessionPath = seedFileSession({
    id: "ses_quarantine",
    directory: "/work/quarantine",
    version: "1.0.153",
  });
  seedFileMessage({ id: "msg_q", sessionID: "ses_quarantine", role: "assistant" });
  seedFilePart({
    id: "prt_future",
    sessionID: "ses_quarantine",
    messageID: "msg_q",
    type: "future-part",
    payload: { keep: "all source data" },
  });

  const trail = await opencodeAdapter.parseSession({
    id: "ses_quarantine",
    adapter: "opencode",
    path: sessionPath,
  });
  const entry = trail.groups[0]?.entries.find(
    (candidate) =>
      candidate.type === "system_event" && candidate.payload.kind === "x-opencode/unknown_record",
  );
  expect(entry?.type).toBe("system_event");
  expect(entry?.payload).toEqual({
    kind: "x-opencode/unknown_record",
    data: {
      raw: {
        id: "prt_future",
        sessionID: "ses_quarantine",
        messageID: "msg_q",
        type: "future-part",
        payload: { keep: "all source data" },
      },
    },
  });
  expect(entry?.meta?.["dev.opencode.raw_type"]).toBe("part.future-part");
  expect(trail.groups[0]?.header.parse_fidelity).toEqual({ quarantined_count: 1 });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});

test("parseSession() folds file parts into message attachments and maps upstream-known part types", async () => {
  const sessionPath = seedFileSession({
    id: "ses_parts",
    directory: "/work/parts",
    version: "1.0.153",
  });
  seedFileMessage({
    id: "msg_user_parts",
    sessionID: "ses_parts",
    role: "user",
    created: 1766258474000,
  });
  seedFilePart({
    id: "prt_user_text",
    sessionID: "ses_parts",
    messageID: "msg_user_parts",
    type: "text",
    text: "see attached file",
  });
  seedFilePart({
    id: "prt_user_file",
    sessionID: "ses_parts",
    messageID: "msg_user_parts",
    type: "file",
    url: "file:///work/parts/src/app.ts",
    mime: "text/plain",
    filename: "app.ts",
  });
  seedFileMessage({
    id: "msg_assistant_parts",
    sessionID: "ses_parts",
    role: "assistant",
    created: 1766258475000,
  });
  for (const part of [
    { id: "prt_patch", type: "patch", hash: "patchhash", files: ["src/app.ts"] },
    { id: "prt_snapshot", type: "snapshot", snapshot: "snap_123" },
    { id: "prt_agent", type: "agent", name: "build" },
    {
      id: "prt_retry",
      type: "retry",
      attempt: 2,
      error: { name: "APIError", data: { message: "rate limited" } },
      time: { created: 1766258475000 },
    },
    {
      id: "prt_subtask",
      type: "subtask",
      prompt: "Inspect package scripts",
      description: "Inspect scripts",
      agent: "explore",
    },
  ]) {
    seedFilePart({
      ...part,
      sessionID: "ses_parts",
      messageID: "msg_assistant_parts",
    });
  }

  const trail = await opencodeAdapter.parseSession({
    id: "ses_parts",
    adapter: "opencode",
    path: sessionPath,
  });
  const entries = trail.groups[0]!.entries;
  expect(entries.find((entry) => entry.type === "user_message")).toMatchObject({
    type: "user_message",
    payload: {
      text: "see attached file",
      attachments: [
        {
          kind: "file",
          media_type: "text/plain",
          uri: "file:///work/parts/src/app.ts",
          name: "app.ts",
        },
      ],
    },
  });
  const systemPayloads = entries
    .filter((entry) => entry.type === "system_event")
    .map((entry) => entry.payload);
  expect(systemPayloads).toContainEqual({
    kind: "x-opencode/patch",
    data: { hash: "patchhash", files: ["src/app.ts"] },
  });
  expect(systemPayloads).toContainEqual({
    kind: "x-opencode/snapshot",
    data: { snapshot: "snap_123" },
  });
  expect(systemPayloads).toContainEqual({ kind: "x-opencode/agent", data: { name: "build" } });
  expect(systemPayloads).toContainEqual({
    kind: "x-opencode/retry",
    data: {
      attempt: 2,
      error: { name: "APIError", data: { message: "rate limited" } },
    },
  });
  expect(
    entries.find((entry) => entry.meta?.["dev.opencode.raw_type"] === "part.subtask"),
  ).toMatchObject({
    type: "tool_call",
    payload: {
      tool: "subagent_invoke",
      args: { task: "Inspect package scripts", agent_type: "explore" },
    },
  });
  expect(trail.groups[0]!.header.parse_fidelity).toEqual({ quarantined_count: 0 });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});

test("parseSession() emits useful SQLite session metadata and permission surfaces", async () => {
  const dbPath = seedSqliteSession({
    id: "ses_meta",
    directory: "/work/meta",
    title: "Metadata Session",
    version: "1.0.153",
  });
  updateDbSessionMetadata(dbPath, "ses_meta");
  insertDbMessage(dbPath, {
    id: "msg_meta",
    sessionID: "ses_meta",
    role: "user",
    created: 1766258474000,
  });
  insertDbPart(
    dbPath,
    {
      id: "prt_meta_text",
      sessionID: "ses_meta",
      messageID: "msg_meta",
      type: "text",
      text: "metadata test",
    },
    1766258474000,
  );

  const trail = await opencodeAdapter.parseSession({
    id: "ses_meta",
    adapter: "opencode",
    path: `${dbPath}#ses_meta`,
  });
  const entries = trail.groups[0]!.entries;
  const metadata = entries.filter((entry) => entry.type === "session_metadata_update");
  expect(metadata.map((entry) => entry.payload.field)).toEqual([
    "name",
    "agent.model_default",
    "x-opencode/share_url",
    "x-opencode/token_totals",
    "x-opencode/session_summary",
    "x-opencode/revert",
    "x-opencode/session_permission",
    "x-opencode/session_state",
    "vcs.worktree",
  ]);
  expect(
    metadata.find((entry) => entry.payload.field === "x-opencode/token_totals")?.payload,
  ).toMatchObject({
    value: {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    },
  });
  expect(
    metadata.find((entry) => entry.payload.field === "x-opencode/session_summary")?.payload,
  ).toMatchObject({
    value: {
      additions: 7,
      deletions: 2,
      files: 1,
      diffs: [{ file: "src/app.ts", additions: 7, deletions: 2 }],
    },
  });
  expect(
    entries.find(
      (entry) =>
        entry.type === "system_event" && entry.payload.kind === "x-opencode/permission_ruleset",
    )?.payload,
  ).toMatchObject({
    data: {
      rules: [{ permission: "bash", pattern: "npm *", action: "ask" }],
    },
  });
  expect(metadata.find((entry) => entry.payload.field === "vcs.worktree")?.payload).toMatchObject({
    value: { name: "synthetic-project", path: "/work/meta" },
    reason: "runtime_inferred",
  });
  expect(trail.groups[0]!.header.vcs).toBeUndefined();
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});

test("parseSession() enriches file-storage sessions with matching SQLite metadata", async () => {
  const sessionPath = seedFileSession({
    id: "ses_file_enrich",
    directory: "/work/enrich",
    title: "File Title",
    version: "1.0.153",
  });
  seedFileMessage({ id: "msg_enrich", sessionID: "ses_file_enrich", role: "user" });
  seedFilePart({
    id: "prt_enrich",
    sessionID: "ses_file_enrich",
    messageID: "msg_enrich",
    type: "text",
    text: "hello",
  });
  const dbPath = seedSqliteSession({
    id: "ses_file_enrich",
    directory: "/work/enrich",
    title: "DB Title",
    version: "1.0.167",
  });
  updateDbSessionMetadata(dbPath, "ses_file_enrich");

  const trail = await opencodeAdapter.parseSession({
    id: "ses_file_enrich",
    adapter: "opencode",
    path: sessionPath,
  });
  const group = trail.groups[0]!;
  const fields = group.entries
    .filter((entry) => entry.type === "session_metadata_update")
    .map((entry) => entry.payload.field);
  expect(fields).toContain("x-opencode/token_totals");
  expect(fields).toContain("x-opencode/session_summary");
  expect(fields).toContain("vcs.worktree");
  expect(group.header.agent.version).toBe("1.0.167");
  expect(group.header.cwd).toBe("/work/enrich");
  expect(group.entries.some((entry) => entry.type === "user_message")).toBe(true);
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});

test("parseSession() maps observed extra OpenCode tools and preserves rich result metadata", async () => {
  const sessionPath = seedFileSession({
    id: "ses_tools",
    directory: "/work/tools",
    version: "1.0.153",
  });
  seedFileMessage({
    id: "msg_tools",
    sessionID: "ses_tools",
    role: "assistant",
    created: 1766258475000,
  });
  const tools = [
    {
      id: "prt_todowrite",
      callID: "call-todos",
      tool: "todowrite",
      state: {
        status: "completed",
        input: {
          todos: [
            { content: "Write tests", status: "in_progress", priority: "high", id: "todo-1" },
          ],
        },
        output: "updated",
        title: "Todos updated",
        metadata: { source: "tool" },
      },
    },
    {
      id: "prt_lsp",
      callID: "call-lsp",
      tool: "lsp_diagnostics",
      state: { status: "completed", input: { path: "src/app.ts" }, output: "0 diagnostics" },
    },
    {
      id: "prt_bg",
      callID: "call-bg",
      tool: "background_output",
      state: { status: "completed", input: { commandID: "cmd_123" }, output: "server ready" },
    },
    {
      id: "prt_mcp",
      callID: "call-mcp",
      tool: "context7_get-library-docs",
      state: { status: "completed", input: { topic: "bun" }, output: "docs" },
    },
    {
      id: "prt_read_attach",
      callID: "call-read-attach",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "image.png" },
        output: "image",
        attachments: [
          { url: "file:///work/tools/image.png", mime: "image/png", filename: "image.png" },
        ],
        title: "Read image",
        metadata: { bytes: 10 },
        time: { start: 1766258475000, end: 1766258476000 },
      },
    },
  ];
  for (const tool of tools) {
    seedFilePart({
      ...tool,
      sessionID: "ses_tools",
      messageID: "msg_tools",
      type: "tool",
    });
  }

  const trail = await opencodeAdapter.parseSession({
    id: "ses_tools",
    adapter: "opencode",
    path: sessionPath,
  });
  const entries = trail.groups[0]!.entries;
  expect(
    entries.find((entry) => entry.meta?.["dev.opencode.raw_type"] === "tool.todowrite"),
  ).toMatchObject({
    type: "task_plan_update",
    payload: { items: [{ id: "todo-1", content: "Write tests", status: "in_progress" }] },
  });
  expect(
    entries.find((entry) => entry.meta?.["dev.opencode.raw_type"] === "tool.lsp_diagnostics"),
  ).toMatchObject({
    type: "system_event",
    payload: { kind: "x-opencode/diagnostic", data: { tool: "lsp_diagnostics" } },
  });
  expect(
    entries.find((entry) => entry.semantic?.call_id === "call-bg" && entry.type === "tool_call"),
  ).toMatchObject({
    payload: { tool: "shell_output", args: { command_id: "cmd_123" } },
  });
  expect(
    entries.find((entry) => entry.semantic?.call_id === "call-mcp" && entry.type === "tool_call"),
  ).toMatchObject({
    payload: {
      tool: "mcp_call",
      args: { server: "context7", tool: "get-library-docs", args: { topic: "bun" } },
    },
  });
  expect(
    entries.find(
      (entry) => entry.semantic?.call_id === "call-read-attach" && entry.type === "tool_result",
    ),
  ).toMatchObject({
    payload: {
      ok: true,
      output: "image",
      attachments: [
        {
          kind: "image",
          media_type: "image/png",
          uri: "file:///work/tools/image.png",
          name: "image.png",
        },
      ],
      meta: {
        "x-opencode/tool": {
          title: "Read image",
          metadata: { bytes: 10 },
          time: { start: 1766258475000, end: 1766258476000 },
        },
      },
    },
  });
  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});
