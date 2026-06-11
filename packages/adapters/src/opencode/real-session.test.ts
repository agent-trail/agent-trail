import { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { opencodeAdapter } from "../index.ts";
import { firstJsonFile, ID_PATTERN, runRealSessionSmoke } from "../test-helpers.ts";
import { opencodeDbPath, opencodeStorageDir } from "./paths.ts";

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const OPENCODE_SOURCE_SCHEMA_VERSION = "v1";

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function assertOptionalString(value: unknown, label: string, summary: string): void {
  if (value !== undefined && stringValue(value) === undefined) {
    throw new Error(`${label} must be a non-empty string when present\n${summary}`);
  }
}

function firstOpenCodeSessionJson(root: string | undefined): string | undefined {
  return firstJsonFile(root, (path) => /^ses_.*\.json$/.test(path.split(/[\\/]/).at(-1) ?? ""));
}

function opencodeDbFile(path: string | undefined): string | undefined {
  if (path === undefined || path.length === 0) return undefined;
  if (path.includes("#")) return path;
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) return join(path, "opencode.db");
    if (stat.isFile()) return path;
  } catch {
    return undefined;
  }
  return undefined;
}

function firstOpenCodeDbSession(path: string | undefined): string | undefined {
  const dbPath = opencodeDbFile(path);
  if (dbPath === undefined) return undefined;
  if (dbPath.includes("#")) return dbPath;
  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db.query("SELECT id FROM session ORDER BY time_updated DESC, id ASC LIMIT 1").get();
    const id =
      row !== null &&
      typeof row === "object" &&
      !Array.isArray(row) &&
      typeof (row as Record<string, unknown>).id === "string"
        ? (row as Record<string, string>).id
        : undefined;
    return id === undefined ? undefined : `${dbPath}#${id}`;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

function assertOpenCodeEntry(entry: Entry, toolCallIds: Set<string>, summary: string): void {
  try {
    const source = objectValue(entry.source);
    expect(source?.agent).toBe("opencode");
    if (source?.synthesized !== true) {
      expect(entry.meta?.["dev.opencode.raw_type"]).toEqual(expect.any(String));
      expect(String(entry.meta?.["dev.opencode.raw_type"]).length).toBeGreaterThan(0);
      expect(source?.schema_version).toBe(OPENCODE_SOURCE_SCHEMA_VERSION);
      if (source?.raw !== undefined) expect(objectValue(source.raw)).toBeDefined();
    }

    const payload = objectValue(entry.payload);
    expect(payload).toBeDefined();

    if (entry.semantic !== undefined) {
      assertOptionalString(entry.semantic.call_id, "semantic.call_id", summary);
      assertOptionalString(entry.semantic.tool_kind, "semantic.tool_kind", summary);
    }

    switch (entry.type) {
      case "user_message":
      case "agent_message":
      case "agent_thinking":
        expect(payload?.text).toEqual(expect.any(String));
        assertOptionalString(payload?.model, `${entry.type}.payload.model`, summary);
        break;
      case "tool_call":
        expect(payload?.tool).toEqual(expect.any(String));
        expect(objectValue(payload?.args)).toBeDefined();
        toolCallIds.add(entry.id);
        if (payload?.tool === "file_read") {
          assertOptionalString(objectValue(payload.args)?.path, "file_read.args.path", summary);
        }
        if (payload?.tool === "file_write") {
          assertOptionalString(objectValue(payload.args)?.path, "file_write.args.path", summary);
          assertOptionalString(
            objectValue(payload.args)?.content,
            "file_write.args.content",
            summary,
          );
        }
        if (payload?.tool === "file_edit") {
          assertOptionalString(objectValue(payload.args)?.path, "file_edit.args.path", summary);
          assertOptionalString(objectValue(payload.args)?.diff, "file_edit.args.diff", summary);
        }
        if (payload?.tool === "shell_command") {
          assertOptionalString(
            objectValue(payload.args)?.command,
            "shell_command.args.command",
            summary,
          );
        }
        if (payload?.tool === "web_fetch") {
          assertOptionalString(objectValue(payload.args)?.url, "web_fetch.args.url", summary);
        }
        if (payload?.tool === "subagent_invoke") {
          assertOptionalString(
            objectValue(payload.args)?.task,
            "subagent_invoke.args.task",
            summary,
          );
        }
        if (payload?.tool === "other") {
          assertOptionalString(objectValue(payload.args)?.name, "other.args.name", summary);
        }
        break;
      case "tool_result":
        expect(payload?.for_id).toMatch(ID_PATTERN);
        expect(toolCallIds.has(String(payload?.for_id))).toBe(true);
        expect(typeof payload?.ok).toBe("boolean");
        assertOptionalString(payload?.output, "tool_result.payload.output", summary);
        assertOptionalString(payload?.error, "tool_result.payload.error", summary);
        break;
      case "tool_call_aborted":
        if (payload?.scope === "tool_call") {
          expect(payload?.for_id).toMatch(ID_PATTERN);
          expect(toolCallIds.has(String(payload?.for_id))).toBe(true);
        }
        assertOptionalString(payload?.reason, "tool_call_aborted.payload.reason", summary);
        break;
      case "context_compact":
        expect(payload?.summary).toEqual(expect.any(String));
        if (payload?.trigger !== undefined) {
          expect(["auto", "manual"].includes(String(payload.trigger))).toBe(true);
        }
        break;
      case "model_change":
        expect(payload?.to_model).toEqual(expect.any(String));
        assertOptionalString(payload?.from_model, "model_change.payload.from_model", summary);
        assertOptionalString(payload?.to_provider, "model_change.payload.to_provider", summary);
        break;
      case "task_plan_update": {
        expect(Array.isArray(payload?.items)).toBe(true);
        for (const item of (payload?.items ?? []) as unknown[]) {
          const obj = objectValue(item);
          expect(obj?.id).toEqual(expect.any(String));
          expect(obj?.content).toEqual(expect.any(String));
          expect(
            ["pending", "in_progress", "completed", "cancelled", "blocked"].includes(
              String(obj?.status),
            ),
          ).toBe(true);
        }
        break;
      }
      case "session_terminated":
        expect(payload?.reason).toEqual(expect.any(String));
        if (Array.isArray(payload?.open_call_ids)) {
          for (const id of payload.open_call_ids) expect(String(id)).toMatch(ID_PATTERN);
        }
        break;
      case "system_event":
        expect(payload?.kind).toEqual(expect.any(String));
        if (payload?.kind === "x-opencode/unknown_record") {
          expect(objectValue(objectValue(payload.data)?.raw)).toBeDefined();
        }
        break;
    }
  } catch (error) {
    throw new Error(
      `OpenCode real-session optional-field invariant failed for ${entry.type}: ${
        error instanceof Error ? error.message : String(error)
      }\n${summary}`,
    );
  }
}

// Opt-in real-session test. Hard-skipped in CI and skipped locally unless
// AGENT_TRAIL_REAL_OPENCODE_ROOT points to a real OpenCode root/session file, or
// a session exists under OpenCode's default storage dir.
//
//   AGENT_TRAIL_REAL_OPENCODE_ROOT=/abs/path/to/opencode bun test packages/adapters
runRealSessionSmoke({
  adapter: opencodeAdapter,
  envVar: "AGENT_TRAIL_REAL_OPENCODE_ROOT",
  expectedAgentName: "opencode",
  fallbackSessionId: "real-opencode-session",
  resolveSessionPath: (path) => firstOpenCodeSessionJson(path),
  defaultSessionPath: () => firstOpenCodeSessionJson(opencodeStorageDir()),
  testName:
    "real OpenCode session (AGENT_TRAIL_REAL_OPENCODE_ROOT) parses, validates, and exposes feature coverage",
  assertTrail: (trail, summary) => {
    expect(trail.envelope?.content_hash).toMatch(HEX_SHA256);
    const group = trail.groups[0]!;
    expect(group.header.content_hash).toMatch(HEX_SHA256);
    expect(group.header.source?.agent).toBe("opencode");
    assertOptionalString(group.header.agent.version, "header.agent.version", summary);
    assertOptionalString(
      group.header.source?.format_version,
      "header.source.format_version",
      summary,
    );
    const toolCallIds = new Set<string>();
    for (const entry of group.entries) assertOpenCodeEntry(entry, toolCallIds, summary);
  },
});

// Opt-in DB real-session test. Hard-skipped in CI and skipped locally unless
// AGENT_TRAIL_REAL_OPENCODE_DB_SESSION points to a real OpenCode DB, DB#session
// ref, or OpenCode data root. Falls back to the default OpenCode DB.
//
//   AGENT_TRAIL_REAL_OPENCODE_DB_SESSION=/abs/path/to/opencode.db#ses_... bun test packages/adapters
runRealSessionSmoke({
  adapter: opencodeAdapter,
  envVar: "AGENT_TRAIL_REAL_OPENCODE_DB_SESSION",
  expectedAgentName: "opencode",
  fallbackSessionId: "real-opencode-db-session",
  resolveSessionPath: firstOpenCodeDbSession,
  defaultSessionPath: () => firstOpenCodeDbSession(opencodeDbPath()),
  testName:
    "real OpenCode SQLite session (AGENT_TRAIL_REAL_OPENCODE_DB_SESSION) parses, validates, and exposes feature coverage",
  assertTrail: (trail, summary) => {
    expect(trail.envelope?.content_hash).toMatch(HEX_SHA256);
    const group = trail.groups[0]!;
    expect(group.header.content_hash).toMatch(HEX_SHA256);
    expect(group.header.source?.agent).toBe("opencode");
    expect(group.header.source?.path).toContain("opencode.db#");
    assertOptionalString(group.header.agent.version, "header.agent.version", summary);
    assertOptionalString(
      group.header.source?.format_version,
      "header.source.format_version",
      summary,
    );
    const toolCallIds = new Set<string>();
    for (const entry of group.entries) assertOpenCodeEntry(entry, toolCallIds, summary);
  },
});
