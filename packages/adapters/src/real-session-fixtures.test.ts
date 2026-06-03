import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateTrailString } from "@agent-trail/core";
import {
  claudeCodeAdapter,
  codexAdapter,
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
const SENSITIVE_VALUE_KEYS = new Set([
  "agentName",
  "addedBlocks",
  "aiTitle",
  "answer",
  "arguments",
  "base_instructions",
  "body",
  "cmd",
  "command",
  "content",
  "cwd",
  "description",
  "details",
  "developer_instructions",
  "encrypted_content",
  "error",
  "filename",
  "gitBranch",
  "input",
  "instructions",
  "last_agent_message",
  "lastAgentMessage",
  "lastPrompt",
  "lines",
  "message",
  "newText",
  "path",
  "oldText",
  "planContent",
  "planFilePath",
  "prNumber",
  "prRepository",
  "prUrl",
  "prompt",
  "readFiles",
  "remote_url",
  "repository_url",
  "signature",
  "snippet",
  "stderr",
  "stdout",
  "summary",
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
];

let previousCodexHome: string | undefined;
let isolatedCodexHome: string;

beforeEach(async () => {
  previousCodexHome = process.env.CODEX_HOME;
  isolatedCodexHome = join(tmpdir(), `agent-trail-codex-home-${crypto.randomUUID()}`);
  await mkdir(isolatedCodexHome, { recursive: true });
  process.env.CODEX_HOME = isolatedCodexHome;
});

afterEach(async () => {
  if (previousCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = previousCodexHome;
  }
  await rm(isolatedCodexHome, { recursive: true, force: true });
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

      const trail = await fixture.adapter.parseSession({
        id: fixture.key,
        adapter: fixture.adapter.name,
        path: sourcePath,
      });
      const group = trail.groups[0];
      expect(group?.header.agent.name).toBe(fixture.expectedAgentName);
      expect(group?.header.agent.version).toBe(fixture.expectedSourceVersion);

      const actualText = jsonl(normalizedTrailRecords(trailRecords(trail)));
      expect(actualText).toBe(expectedText);

      assertExpectedFeatureTypes(fixture, actualText);

      const diagnostics = await validateTrailString(actualText);
      expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    },
    REAL_FIXTURE_TIMEOUT_MS,
  );
}

function normalizedTrailRecords(records: object[]): object[] {
  const normalized = structuredClone(records) as Record<string, unknown>[];
  const envelope = normalized[0];
  if (envelope?.type === "trail") {
    envelope.id = NORMALIZED_TRAIL_ID;
    envelope.ts = NORMALIZED_TRAIL_TS;
  }
  return normalized;
}

function jsonl(records: object[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
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
): void {
  if (typeof value === "string") {
    if (SECRET_OR_LOCAL_PATH.test(value)) {
      throw new Error(`${filePath}:${lineNumber} has unredacted local path/secret at ${key}`);
    }
    if (PROJECT_LEAK.test(value)) {
      throw new Error(`${filePath}:${lineNumber} has unredacted project identity at ${key}`);
    }
    if (SENSITIVE_VALUE_KEYS.has(key) && value.length > 0 && !REDACTED_VALUE.test(value)) {
      throw new Error(`${filePath}:${lineNumber} has unredacted sensitive value at ${key}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveValue(item, filePath, lineNumber, key);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      assertNoSensitiveValue(childValue, filePath, lineNumber, childKey);
    }
  }
}
