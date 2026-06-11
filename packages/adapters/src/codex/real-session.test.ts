import { expect } from "bun:test";
import type { TrailFile } from "../index.ts";
import { codexAdapter } from "../index.ts";
import { firstJsonlFile, runRealSessionSmoke } from "../test-helpers.ts";
import { codexUsageFromTokenCount } from "./parser.ts";
import { codexSessionsDir } from "./paths.ts";

type RawObject = Record<string, unknown>;

function objectValue(value: unknown): RawObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawObject)
    : undefined;
}

function expectedUsageFromTokenCount(record: RawObject): RawObject | undefined {
  const payload = objectValue(record.payload);
  if (payload?.type !== "token_count") return undefined;
  return codexUsageFromTokenCount(payload);
}

async function assertCodexTokenCountsCaptured(
  trail: TrailFile,
  summary: string,
  ref: { path?: string },
): Promise<void> {
  if (ref.path === undefined) throw new Error(`real Codex session ref has no path\n${summary}`);
  const sourceText = await Bun.file(ref.path).text();
  const sourceRecords = sourceText
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawObject);
  const expected = sourceRecords.flatMap((record) => {
    const usage = expectedUsageFromTokenCount(record);
    return usage === undefined ? [] : [usage];
  });
  const tokenCountPayloads = sourceRecords
    .map((record) => objectValue(record.payload))
    .filter((payload): payload is RawObject => payload?.type === "token_count");
  const actual = trail.groups.flatMap((group) =>
    group.entries.flatMap((entry) => {
      const usage = objectValue(objectValue(entry.payload)?.usage);
      return usage === undefined ? [] : [usage];
    }),
  );
  if (expected.length === 0)
    throw new Error(`real Codex session had no token_count usage\n${summary}`);
  if (actual.length === 0)
    throw new Error(`real Codex session emitted no canonical usage\n${summary}`);
  expect(
    tokenCountPayloads.some(
      (payload) =>
        objectValue(objectValue(payload.info)?.last_token_usage)?.total_tokens !== undefined,
    ),
  ).toBe(true);
  expect(
    tokenCountPayloads.some(
      (payload) =>
        objectValue(objectValue(payload.info)?.total_token_usage)?.total_tokens !== undefined,
    ),
  ).toBe(true);
  expect(actual.some((usage) => usage.total_tokens !== undefined)).toBe(true);
  expect(actual.some((usage) => usage.total_tokens_cumulative !== undefined)).toBe(true);

  let searchFrom = 0;
  for (const usage of actual) {
    const matchIndex = expected.findIndex((candidate, index) => {
      if (index < searchFrom) return false;
      return Object.entries(usage).every(([key, value]) => candidate[key] === value);
    });
    if (matchIndex === -1) {
      throw new Error(
        `real Codex canonical usage did not match any source token_count: ${JSON.stringify(usage)}\n${summary}`,
      );
    }
    searchFrom = matchIndex + 1;
  }
}

// Opt-in real-session test. Hard-skipped in CI and skipped locally unless
// AGENT_TRAIL_REAL_CODEX_SESSION points to a real Codex session JSONL, or a
// session exists under Codex's default sessions dir.
//
//   AGENT_TRAIL_REAL_CODEX_SESSION=/abs/path/to/rollout-...jsonl bun test packages/adapters
runRealSessionSmoke({
  adapter: codexAdapter,
  envVar: "AGENT_TRAIL_REAL_CODEX_SESSION",
  expectedAgentName: "codex-cli",
  fallbackSessionId: "real-codex-session",
  defaultSessionPath: () =>
    firstJsonlFile(
      codexSessionsDir(),
      (path) => path.split(/[\\/]/).at(-1) === "session_index.jsonl",
    ),
  testName:
    "real Codex session (AGENT_TRAIL_REAL_CODEX_SESSION) parses, validates, and exposes feature coverage",
  assertTrail: assertCodexTokenCountsCaptured,
});
