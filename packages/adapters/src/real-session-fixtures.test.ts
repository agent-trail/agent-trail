import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseJsonlString, stampTrail, validateTrailString } from "@agent-trail/core";
import {
  claudeCodeAdapter,
  codexAdapter,
  opencodeAdapter,
  piAdapter,
  type TrailAdapter,
  trailRecords,
} from "./index.ts";

const FIXTURES_DIR = new URL("../tests/fixtures/real-sessions/", import.meta.url).pathname;
const NORMALIZED_TRAIL_ID = "00000000-0000-4000-8000-000000000000";
const NORMALIZED_TRAIL_TS = "2000-01-01T00:00:00.000Z";

const SECRET_OR_LOCAL_PATH =
  /<home>\/|\/Users\/[^/"\s]+|\/home\/[^/"\s]+|\/tmp\/[^/"\s]+|\/private\/tmp\/[^/"\s]+|[A-Za-z]:\\Users\\[^\\/"\s]+|Bearer\s+[A-Za-z0-9_.-]{12,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|github\.com\/somus\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|BEGIN [A-Z ]*PRIVATE KEY/;
const PROJECT_LEAK =
  /LabelLens|label-lens|role-radar|jazzy-pond|hopperpymcp|dflatline|cotypist-analysis|developer_instructions":"#|user_instructions":"#|encrypted_content":"[^[]/;
const REDACTED_VALUE = /^(?:\[REDACTED_[A-Z0-9_]+\]|\s)+$/;
const REDACTED_PATCH =
  /^\*\*\* Begin Patch\n(?:\*\*\* (?:Update|Add|Delete) File: \[REDACTED_PATH(?:_[A-Z])?\]\n|\*\*\* Move to: \[REDACTED_PATH(?:_[A-Z])?\]\n|@@\n|[-+]\[REDACTED_(?:OLD|NEW)_TEXT\]\n|\*\*\* End Patch\n?)+$/;
const SENSITIVE_VALUE_KEYS = new Set([
  "activeForm",
  "agentName",
  "addedBlocks",
  "aiTitle",
  "answer",
  "arguments",
  "base_instructions",
  "body",
  "cmd",
  "command",
  "confirmCommand",
  "content",
  "cwd",
  "data",
  "description",
  "details",
  "developer_instructions",
  "encrypted_content",
  "error",
  "filename",
  "fullOutputPath",
  "gitBranch",
  "inference_geo",
  "input",
  "instructions",
  "last_agent_message",
  "lastAgentMessage",
  "lastPrompt",
  "lines",
  "message",
  "newText",
  "nightKey",
  "path",
  "oldText",
  "planContent",
  "planFilePath",
  "prNumber",
  "prRepository",
  "prUrl",
  "prompt",
  "quietHours",
  "queries",
  "query",
  "readFiles",
  "remote_url",
  "repository_url",
  "signature",
  "snippet",
  "stderr",
  "stdout",
  "summary",
  "directory",
  "system_prompt",
  "systemPrompt",
  "thinking",
  "thinkingSignature",
  "thinking_signature",
  "toolUseResult",
  "transcript",
  "title",
  "user_instructions",
  "modifiedFiles",
  "value",
]);
const SAFE_METADATA_KEYS_IN_SENSITIVE_CONTEXT = new Set([
  "api",
  "code",
  "completedAtLabel",
  "detail",
  "durationLabel",
  "enum",
  "errorMessage",
  "format",
  "id",
  "image_url",
  "isError",
  "kind",
  "localTime",
  "media_type",
  "callID",
  "messageID",
  "model",
  "name",
  "parentID",
  "phase",
  "priority",
  "provider",
  "projectID",
  "responseId",
  "role",
  "service_tier",
  "sessionID",
  "speed",
  "stopReason",
  "startedAtLabel",
  "stop_reason",
  "status",
  "subagent_type",
  "textSignature",
  "timestamp",
  "tool",
  "toolCallId",
  "toolName",
  "tool_use_id",
  "tool_name",
  "truncatedBy",
  "type",
  "uri",
]);

type Fixture = {
  key: string;
  adapter: TrailAdapter;
  expectedAgentName: string;
  expectedSourceVersion?: string;
  expectedFeatureTypes: string[];
};

const FIXTURES: Fixture[] = [
  {
    key: "codex-v0_128",
    adapter: codexAdapter,
    expectedAgentName: "codex-cli",
    expectedSourceVersion: "0.128.0",
    expectedFeatureTypes: [
      "agent_message",
      "context_compact",
      "mode_change",
      "model_change",
      "system_event",
      "thinking_level_change",
      "tool_call",
      "tool_result",
      "user_message",
    ],
  },
  {
    key: "codex-v0_135",
    adapter: codexAdapter,
    expectedAgentName: "codex-cli",
    expectedSourceVersion: "0.135.0-alpha.1",
    expectedFeatureTypes: [
      "agent_message",
      "capability_change",
      "context_compact",
      "mode_change",
      "model_change",
      "system_event",
      "thinking_level_change",
      "tool_call",
      "tool_result",
      "user_message",
    ],
  },
  {
    key: "claude-code-v1",
    adapter: claudeCodeAdapter,
    expectedAgentName: "claude-code",
    expectedFeatureTypes: [
      "agent_message",
      "agent_thinking",
      "capability_change",
      "context_compact",
      "mode_change",
      "model_change",
      "session_metadata_update",
      "system_event",
      "tool_call",
      "tool_call_aborted",
      "tool_result",
      "user_message",
    ],
  },
  {
    key: "pi-v1",
    adapter: piAdapter,
    expectedAgentName: "pi",
    expectedSourceVersion: "3",
    expectedFeatureTypes: [
      "agent_message",
      "agent_thinking",
      "context_compact",
      "model_change",
      "session_metadata_update",
      "system_event",
      "thinking_level_change",
      "tool_call",
      "tool_result",
      "user_interrupt",
      "user_message",
    ],
  },
  {
    key: "pi-v1-edit-forms",
    adapter: piAdapter,
    expectedAgentName: "pi",
    expectedSourceVersion: "3",
    expectedFeatureTypes: ["tool_call", "tool_result"],
  },
  {
    key: "opencode-v1",
    adapter: opencodeAdapter,
    expectedAgentName: "opencode",
    expectedSourceVersion: "1.0.127",
    expectedFeatureTypes: [
      "agent_message",
      "session_metadata_update",
      "system_event",
      "tool_result",
      "tool_call",
      "task_plan_update",
      "user_message",
    ],
  },
];

let previousCodexHome: string | undefined;
let previousOpencodeDataDir: string | undefined;
let previousOpencodeDb: string | undefined;
let isolatedCodexHome: string;
let isolatedOpenCodeDataDir: string;

beforeEach(async () => {
  previousCodexHome = process.env.CODEX_HOME;
  previousOpencodeDataDir = process.env.OPENCODE_DATA_DIR;
  previousOpencodeDb = process.env.OPENCODE_DB;
  isolatedCodexHome = join(tmpdir(), `agent-trail-codex-home-${randomUUID()}`);
  isolatedOpenCodeDataDir = join(tmpdir(), `agent-trail-opencode-data-${randomUUID()}`);
  await mkdir(isolatedCodexHome, { recursive: true });
  await mkdir(isolatedOpenCodeDataDir, { recursive: true });
  process.env.CODEX_HOME = isolatedCodexHome;
  process.env.OPENCODE_DATA_DIR = isolatedOpenCodeDataDir;
  delete process.env.OPENCODE_DB;
});

afterEach(async () => {
  if (previousCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = previousCodexHome;
  }
  if (previousOpencodeDataDir === undefined) {
    delete process.env.OPENCODE_DATA_DIR;
  } else {
    process.env.OPENCODE_DATA_DIR = previousOpencodeDataDir;
  }
  if (previousOpencodeDb === undefined) {
    delete process.env.OPENCODE_DB;
  } else {
    process.env.OPENCODE_DB = previousOpencodeDb;
  }
  await rm(isolatedCodexHome, { recursive: true, force: true });
  await rm(isolatedOpenCodeDataDir, { recursive: true, force: true });
});

test("real source fixtures cover every implemented source schema key", async () => {
  const files = (await readdir(FIXTURES_DIR)).filter((name) => name.endsWith(".jsonl")).sort();
  expect(files).toEqual(
    FIXTURES.flatMap(({ key }) => [`${key}.source.jsonl`, `${key}.trail.jsonl`]).sort(),
  );
});

const REAL_FIXTURE_TIMEOUT_MS = 15_000;

for (const fixture of FIXTURES) {
  test(
    `real source fixture ${fixture.key} matches expected trail output`,
    async () => {
      const sourcePath = join(FIXTURES_DIR, `${fixture.key}.source.jsonl`);
      const expectedPath = join(FIXTURES_DIR, `${fixture.key}.trail.jsonl`);
      const sourceText = await Bun.file(sourcePath).text();
      const expectedText = await Bun.file(expectedPath).text();

      expect(sourceText).not.toMatch(SECRET_OR_LOCAL_PATH);
      expect(expectedText).not.toMatch(SECRET_OR_LOCAL_PATH);
      expect(sourceText).not.toMatch(PROJECT_LEAK);
      expect(expectedText).not.toMatch(PROJECT_LEAK);
      assertNoSensitiveFixtureValues(sourceText, sourcePath);
      assertNoSensitiveFixtureValues(expectedText, expectedPath);

      const materializedSourcePath = await materializeFixtureSource(fixture, sourcePath);
      const trail = await fixture.adapter.parseSession({
        id: fixture.key,
        adapter: fixture.adapter.name,
        path: materializedSourcePath,
      });
      const group = trail.groups[0];
      expect(group?.header.agent.name).toBe(fixture.expectedAgentName);
      expect(group?.header.agent.version).toBe(fixture.expectedSourceVersion);

      const actualText = jsonl(await normalizedTrailRecords(trailRecords(trail)));
      expect(actualText).toBe(expectedText);

      assertExpectedFeatureTypes(fixture, actualText);

      const diagnostics = await validateTrailString(actualText);
      expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    },
    REAL_FIXTURE_TIMEOUT_MS,
  );
}

async function normalizedTrailRecords(records: object[]): Promise<object[]> {
  const normalized = structuredClone(records) as Record<string, unknown>[];
  const envelope = normalized[0];
  if (envelope?.type === "trail") {
    envelope.id = NORMALIZED_TRAIL_ID;
    envelope.ts = NORMALIZED_TRAIL_TS;
  }
  const scrubbedPath = scrubMaterializedOpenCodePaths(normalized);
  if (scrubbedPath) {
    const parsed = await parseJsonlString(jsonl(normalized));
    stampTrail(parsed);
    return parsed.map((record) => record.value as object);
  }
  return normalized;
}

function scrubMaterializedOpenCodePaths(value: unknown): boolean {
  let scrubbed = false;
  if (Array.isArray(value)) {
    for (const item of value) scrubbed = scrubMaterializedOpenCodePaths(item) || scrubbed;
    return scrubbed;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (
        key === "path" &&
        typeof child === "string" &&
        (child.includes("agent-trail-opencode-data-") ||
          child.includes("agent-trail-opencode-fixture-"))
      ) {
        (value as Record<string, unknown>)[key] = "[REDACTED_PATH]";
        scrubbed = true;
      } else {
        scrubbed = scrubMaterializedOpenCodePaths(child) || scrubbed;
      }
    }
  }
  return scrubbed;
}

function jsonl(records: object[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function materializeFixtureSource(fixture: Fixture, sourcePath: string): Promise<string> {
  if (fixture.adapter.name !== "opencode") return sourcePath;

  const records = (await Bun.file(sourcePath).text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  let sessionPath: string | undefined;
  for (const record of records) {
    const data = objectValue(record.data) ?? record;
    switch (record.type) {
      case "session": {
        const id = stringValue(data.id);
        const projectID = stringValue(data.projectID);
        if (id === undefined || projectID === undefined) {
          throw new Error(`${sourcePath} has invalid OpenCode session fixture record`);
        }
        sessionPath = join(isolatedOpenCodeDataDir, "storage", "session", projectID, `${id}.json`);
        await writeFixtureJson(sessionPath, data);
        break;
      }
      case "message": {
        const id = stringValue(data.id);
        const sessionID = stringValue(data.sessionID);
        if (id === undefined || sessionID === undefined) {
          throw new Error(`${sourcePath} has invalid OpenCode message fixture record`);
        }
        await writeFixtureJson(
          join(isolatedOpenCodeDataDir, "storage", "message", sessionID, `${id}.json`),
          data,
        );
        break;
      }
      case "part": {
        const id = stringValue(data.id);
        const messageID = stringValue(data.messageID);
        if (id === undefined || messageID === undefined) {
          throw new Error(`${sourcePath} has invalid OpenCode part fixture record`);
        }
        await writeFixtureJson(
          join(isolatedOpenCodeDataDir, "storage", "part", messageID, `${id}.json`),
          data,
        );
        break;
      }
      case "todo": {
        const sessionID = stringValue(data.sessionID);
        const todos = Array.isArray(data.todos) ? data.todos : [data];
        if (sessionID === undefined) {
          throw new Error(`${sourcePath} has invalid OpenCode todo fixture record`);
        }
        await writeFixtureJson(
          join(isolatedOpenCodeDataDir, "storage", "todo", `${sessionID}.json`),
          todos,
        );
        break;
      }
    }
  }
  if (sessionPath === undefined) throw new Error(`${sourcePath} has no OpenCode session record`);
  return sessionPath;
}

async function writeFixtureJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(stripFixtureRecordType(value), null, 2)}\n`);
}

function stripFixtureRecordType(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFixtureRecordType);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "type" && ["session", "message", "part", "todo"].includes(String(child))) {
        continue;
      }
      out[key] = stripFixtureRecordType(child);
    }
    return out;
  }
  return value;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function assertExpectedFeatureTypes(fixture: Fixture, text: string): void {
  const records = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string });
  const present = new Set(
    records.map((record) => record.type).filter((type) => type !== undefined),
  );
  for (const type of fixture.expectedFeatureTypes) {
    if (!present.has(type)) {
      throw new Error(
        `${fixture.key} missing expected event family ${type}; present=${[...present].sort().join(",")}`,
      );
    }
  }
}

function assertNoSensitiveFixtureValues(text: string, filePath: string): void {
  for (const [lineNumber, line] of text.split("\n").entries()) {
    if (line.length === 0) continue;
    assertNoSensitiveValue(JSON.parse(line), filePath, lineNumber + 1);
  }
}

function assertNoSensitiveValue(
  value: unknown,
  filePath: string,
  lineNumber: number,
  key = "",
  inSensitiveContext = false,
): void {
  const keyIsSensitive =
    SENSITIVE_VALUE_KEYS.has(key) &&
    (key !== "data" || typeof value === "string" || Array.isArray(value));
  const sensitiveContext = inSensitiveContext || keyIsSensitive;
  if (typeof value === "string") {
    if (SECRET_OR_LOCAL_PATH.test(value)) {
      throw new Error(`${filePath}:${lineNumber} has unredacted local path/secret at ${key}`);
    }
    if (PROJECT_LEAK.test(value)) {
      throw new Error(`${filePath}:${lineNumber} has unredacted project identity at ${key}`);
    }
    if (
      sensitiveContext &&
      !SAFE_METADATA_KEYS_IN_SENSITIVE_CONTEXT.has(key) &&
      value.length > 0 &&
      !(key === "value" && /^(?:claude|gpt-|github-copilot|openai|anthropic)/.test(value)) &&
      !(key === "patch" && REDACTED_PATCH.test(value)) &&
      !REDACTED_VALUE.test(value)
    ) {
      throw new Error(`${filePath}:${lineNumber} has unredacted sensitive value at ${key}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoSensitiveValue(item, filePath, lineNumber, key, sensitiveContext);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      assertNoSensitiveValue(childValue, filePath, lineNumber, childKey, sensitiveContext);
    }
  }
}
