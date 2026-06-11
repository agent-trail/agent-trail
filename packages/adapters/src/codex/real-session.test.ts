import { expect } from "bun:test";
import type { TrailFile } from "../index.ts";
import { codexAdapter } from "../index.ts";
import { firstJsonlFile, runRealSessionSmoke } from "../test-helpers.ts";
import { codexSessionsDir } from "./paths.ts";

type RawObject = Record<string, unknown>;

function objectValue(value: unknown): RawObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RawObject)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function expectedUsageFromTokenCount(record: RawObject): RawObject | undefined {
  const payload = objectValue(record.payload);
  if (payload?.type !== "token_count") return undefined;
  const info = objectValue(payload.info);
  if (info === undefined) return undefined;
  const last = objectValue(info.last_token_usage) ?? {};
  const total = objectValue(info.total_token_usage) ?? {};
  const out: RawObject = {};
  const input = numberValue(last.input_tokens);
  const cacheRead = numberValue(last.cached_input_tokens);
  if (input !== undefined) {
    out.input_tokens = Math.max(0, input - (cacheRead ?? 0));
    out.context_input_tokens = input;
  }
  const output = numberValue(last.output_tokens);
  if (output !== undefined) out.output_tokens = output;
  if (cacheRead !== undefined) out.cache_read_tokens = cacheRead;
  const reasoning = numberValue(last.reasoning_output_tokens);
  if (reasoning !== undefined) out.reasoning_tokens = reasoning;
  const totalTokens = numberValue(last.total_tokens);
  if (totalTokens !== undefined) out.total_tokens = totalTokens;
  const inputCumulative = numberValue(total.input_tokens);
  const cacheReadCumulative = numberValue(total.cached_input_tokens);
  if (inputCumulative !== undefined) {
    out.input_tokens_cumulative = Math.max(0, inputCumulative - (cacheReadCumulative ?? 0));
  }
  const outputCumulative = numberValue(total.output_tokens);
  if (outputCumulative !== undefined) out.output_tokens_cumulative = outputCumulative;
  const totalCumulative = numberValue(total.total_tokens);
  if (totalCumulative !== undefined) out.total_tokens_cumulative = totalCumulative;
  const contextWindow = numberValue(info.model_context_window);
  if (contextWindow !== undefined) out.context_window_tokens = contextWindow;
  return Object.keys(out).length > 0 ? out : undefined;
}

async function assertCodexTokenCountsCaptured(
  trail: TrailFile,
  summary: string,
  ref: { path?: string },
): Promise<void> {
  if (ref.path === undefined) throw new Error(`real Codex session ref has no path\n${summary}`);
  const sourceText = await Bun.file(ref.path).text();
  const expected = sourceText
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const usage = expectedUsageFromTokenCount(JSON.parse(line) as RawObject);
      return usage === undefined ? [] : [usage];
    });
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
