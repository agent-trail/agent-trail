import { expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentName, Entry } from "@agent-trail/types";
import type { SessionRef, TrailAdapter, TrailFile } from "./index.ts";
import { validateAdapterTrail } from "./index.ts";

export const ID_PATTERN =
  /^(?:[0-9a-hjkmnp-tv-zA-HJKMNP-TV-Z]{26}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})$/;

const FEATURE_TYPES = [
  "user_message",
  "agent_message",
  "tool_call",
  "tool_result",
  "tool_call_aborted",
  "agent_thinking",
  "context_compact",
  "model_change",
  "mode_change",
  "thinking_level_change",
  "system_event",
  "session_metadata_update",
  "capability_change",
] as const;

type FeatureType = (typeof FEATURE_TYPES)[number];

type RealSessionSmokeOptions = {
  adapter: TrailAdapter;
  envVar: string;
  expectedAgentName: AgentName;
  testName: string;
  fallbackSessionId: string;
  defaultSessionPath?: () => string | undefined;
  resolveSessionPath?: (path: string) => string | undefined;
  assertTrail?: (trail: TrailFile, summary: string, ref: SessionRef) => void | Promise<void>;
};

type DirectoryEntry = {
  name: string;
  isDirectory(): boolean;
};

export function firstJsonlFile(
  root: string | undefined,
  exclude?: (path: string) => boolean,
): string | undefined {
  if (root === undefined) return undefined;
  let entries: DirectoryEntry[];
  try {
    entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = firstJsonlFile(path, exclude);
      if (found !== undefined) return found;
      continue;
    }
    if (!entry.name.endsWith(".jsonl")) continue;
    if (exclude?.(path) === true) continue;
    try {
      if (statSync(path).isFile()) return path;
    } catch {}
  }
  return undefined;
}

export function firstJsonFile(
  root: string | undefined,
  include?: (path: string) => boolean,
): string | undefined {
  if (root === undefined) return undefined;
  try {
    const stat = statSync(root);
    if (stat.isFile() && root.endsWith(".json") && include?.(root) !== false) return root;
    if (!stat.isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  let entries: DirectoryEntry[];
  try {
    entries = readdirSync(root, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = firstJsonFile(path, include);
      if (found !== undefined) return found;
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    if (include?.(path) === false) continue;
    try {
      if (statSync(path).isFile()) return path;
    } catch {}
  }
  return undefined;
}

function enabledRealSessionRef(options: RealSessionSmokeOptions): SessionRef | undefined {
  if (process.env.CI !== undefined && process.env.CI.length > 0) return undefined;
  const customPath = process.env[options.envVar];
  const path =
    customPath === undefined || customPath.length === 0
      ? options.defaultSessionPath?.()
      : (options.resolveSessionPath?.(customPath) ?? customPath);
  if (path === undefined || path.length === 0) return undefined;
  return {
    id: options.fallbackSessionId,
    adapter: options.adapter.name,
    path,
  };
}

function entryCounts(entries: Entry[]): Record<FeatureType, number> {
  const out = Object.fromEntries(FEATURE_TYPES.map((type) => [type, 0])) as Record<
    FeatureType,
    number
  >;
  for (const entry of entries) {
    if (FEATURE_TYPES.includes(entry.type as FeatureType)) {
      out[entry.type as FeatureType] += 1;
    }
  }
  return out;
}

function smokeSummary(entries: Entry[]): string {
  return JSON.stringify(
    {
      total_entries: entries.length,
      feature_counts: entryCounts(entries),
      missing_feature_types: FEATURE_TYPES.filter((type) => !entries.some((e) => e.type === type)),
    },
    null,
    2,
  );
}

function assertEntryShape(entry: Entry, summary: string): void {
  try {
    expect(entry.id).toMatch(ID_PATTERN);
    expect(typeof entry.ts).toBe("string");
    expect(entry.ts.length).toBeGreaterThan(0);
    expect(typeof entry.type).toBe("string");
    expect(entry.type.length).toBeGreaterThan(0);
  } catch (error) {
    throw new Error(
      `real-session smoke emitted a malformed entry: ${error instanceof Error ? error.message : String(error)}\n${summary}`,
    );
  }
}

function assertFeatureInvariants(entry: Entry, summary: string): void {
  try {
    const payload = entry.payload as Record<string, unknown>;
    assertAttachmentShape(payload.attachments);

    if (entry.type === "tool_call" && entry.payload.tool === "file_edit") {
      assertFileEditArgs(entry.payload.args);
    }
    if (entry.type === "tool_result") {
      expect(entry.payload.for_id).toMatch(ID_PATTERN);
    }
    if (entry.type === "tool_call_aborted" && entry.payload.scope === "tool_call") {
      expect(entry.payload.for_id).toMatch(ID_PATTERN);
    }
    if (entry.type === "context_compact" && Array.isArray(entry.payload.replaced_message_ids)) {
      for (const id of entry.payload.replaced_message_ids) {
        expect(id).toMatch(ID_PATTERN);
      }
    }
  } catch (error) {
    throw new Error(
      `real-session smoke feature invariant failed: ${error instanceof Error ? error.message : String(error)}\n${summary}`,
    );
  }
}

function assertAttachmentShape(attachments: unknown): void {
  if (attachments === undefined) return;
  expect(Array.isArray(attachments)).toBe(true);
  for (const attachment of attachments as unknown[]) {
    expect(attachment).toEqual(expect.any(Object));
    const item = attachment as Record<string, unknown>;
    expect(item.kind).toEqual(expect.any(String));
    expect(String(item.kind).length).toBeGreaterThan(0);
    if (item.uri !== undefined) {
      expect(item.uri).toEqual(expect.any(String));
      expect(String(item.uri).length).toBeGreaterThan(0);
    }
    if (item.name !== undefined) {
      expect(item.name).toEqual(expect.any(String));
      expect(String(item.name).length).toBeGreaterThan(0);
    }
    expect(item.uri !== undefined || item.name !== undefined).toBe(true);
    if (item.media_type !== undefined) {
      expect(item.media_type).toEqual(expect.any(String));
      expect(String(item.media_type).length).toBeGreaterThan(0);
    }
  }
}

function assertFileEditArgs(args: unknown): void {
  expect(args).toEqual(expect.any(Object));
  const value = args as Record<string, unknown>;
  expect(value.path).toEqual(expect.any(String));
  expect(String(value.path).length).toBeGreaterThan(0);
  const hasDiff = value.diff !== undefined;
  const hasReplacement = value.old !== undefined && value.new !== undefined;
  expect(hasDiff || hasReplacement).toBe(true);
  expect(hasDiff && hasReplacement).toBe(false);
  if (hasDiff) {
    expect(value.diff).toEqual(expect.any(String));
    expect(String(value.diff).length).toBeGreaterThan(0);
  }
  if (hasReplacement) {
    expect(value.old).toEqual(expect.any(String));
    expect(value.new).toEqual(expect.any(String));
    if (value.replace_all !== undefined) expect(typeof value.replace_all).toBe("boolean");
  }
}

export function runRealSessionSmoke(options: RealSessionSmokeOptions): void {
  const ref = enabledRealSessionRef(options);

  test.skipIf(ref === undefined)(options.testName, async () => {
    if (ref === undefined) return;
    const trail = await options.adapter.parseSession(ref);
    const group = trail.groups[0];
    expect(group).toBeDefined();
    expect(group!.header.agent.name).toBe(options.expectedAgentName);
    expect(group!.entries.length).toBeGreaterThan(0);

    const summary = smokeSummary(group!.entries);
    for (const entry of group!.entries) {
      assertEntryShape(entry, summary);
      assertFeatureInvariants(entry, summary);
    }

    const diagnostics = await validateAdapterTrail(trail);
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      throw new Error(
        `real-session smoke validation errors:\n${JSON.stringify(errors, null, 2)}\n${summary}`,
      );
    }
    await options.assertTrail?.(trail, summary, ref);
  });
}

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

function pickNumber(record: RawObject | undefined, keys: readonly string[]): number | undefined {
  if (record === undefined) return undefined;
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function embeddedUsageSource(raw: unknown): RawObject | undefined {
  const obj = objectValue(raw);
  if (obj === undefined) return undefined;
  const envelope = objectValue(obj.envelope);
  const envelopeMessage = objectValue(envelope?.message);
  const directMessage = objectValue(obj.message);
  const tokens = objectValue(obj.tokens);
  return (
    objectValue(envelopeMessage?.usage) ??
    objectValue(directMessage?.usage) ??
    objectValue(obj.usage) ??
    (tokens !== undefined ? { tokens } : undefined) ??
    (pickNumber(obj, ["tokens_input", "tokens_output", "tokens_total"]) !== undefined
      ? obj
      : undefined)
  );
}

function sourceTotal(source: RawObject): number | undefined {
  return (
    pickNumber(source, [
      "total_tokens",
      "totalTokens",
      "total",
      "totalTokenCount",
      "tokens_total",
    ]) ?? pickNumber(objectValue(source.tokens), ["total"])
  );
}

function sourceTotalCumulative(source: RawObject): number | undefined {
  return (
    pickNumber(source, [
      "total_tokens_cumulative",
      "totalTokensCumulative",
      "cumulativeTotalTokens",
      "cumulative_total",
      "cumulativeTotal",
      "totalCumulative",
      "tokens_total_cumulative",
    ]) ?? pickNumber(objectValue(source.tokens), ["total_cumulative", "cumulativeTotal"])
  );
}

function sourceInput(source: RawObject): number | undefined {
  return (
    pickNumber(source, ["input_tokens", "inputTokens", "input", "tokens_input"]) ??
    pickNumber(objectValue(source.tokens), ["input"])
  );
}

function sourceOutput(source: RawObject): number | undefined {
  return (
    pickNumber(source, ["output_tokens", "outputTokens", "output", "tokens_output"]) ??
    pickNumber(objectValue(source.tokens), ["output"])
  );
}

function sourceCacheRead(source: RawObject): number | undefined {
  return (
    pickNumber(source, [
      "cache_read_input_tokens",
      "cache_read_tokens",
      "cacheReadInputTokens",
      "cacheReadTokens",
      "cacheRead",
      "tokens_cache_read",
    ]) ?? pickNumber(objectValue(objectValue(source.tokens)?.cache), ["read"])
  );
}

function sourceCacheCreate(source: RawObject): number | undefined {
  return (
    pickNumber(source, [
      "cache_creation_input_tokens",
      "cache_creation_tokens",
      "cacheCreationInputTokens",
      "cacheCreationTokens",
      "cacheWrite",
      "tokens_cache_write",
    ]) ?? pickNumber(objectValue(objectValue(source.tokens)?.cache), ["write"])
  );
}

function sourceReasoning(source: RawObject): number | undefined {
  return (
    pickNumber(source, ["reasoning_tokens", "reasoningTokens", "tokens_reasoning"]) ??
    pickNumber(objectValue(source.tokens), ["reasoning"])
  );
}

export function assertEmbeddedSourceUsageCaptured(trail: TrailFile, summary: string): void {
  let checked = 0;
  let checkedAnyTotal = 0;
  for (const group of trail.groups) {
    for (const entry of group.entries) {
      const payload = objectValue(entry.payload);
      const usage = objectValue(payload?.usage);
      if (usage === undefined) continue;
      const source = embeddedUsageSource(entry.source?.raw);
      if (source === undefined) continue;
      checked += 1;

      const total = sourceTotal(source);
      if (total !== undefined) {
        checkedAnyTotal += 1;
        expect(usage.total_tokens).toBe(total);
      }
      const totalCumulative = sourceTotalCumulative(source);
      if (totalCumulative !== undefined) {
        checkedAnyTotal += 1;
        expect(usage.total_tokens_cumulative).toBe(totalCumulative);
      }
      const input = sourceInput(source);
      if (input !== undefined) expect(usage.input_tokens).toBe(input);
      const output = sourceOutput(source);
      if (output !== undefined) expect(usage.output_tokens).toBe(output);
      const cacheRead = sourceCacheRead(source);
      if (cacheRead !== undefined) expect(usage.cache_read_tokens).toBe(cacheRead);
      const cacheCreate = sourceCacheCreate(source);
      if (cacheCreate !== undefined) expect(usage.cache_creation_tokens).toBe(cacheCreate);
      const reasoning = sourceReasoning(source);
      if (reasoning !== undefined) expect(usage.reasoning_tokens).toBe(reasoning);
    }
  }
  if (checked === 0 && trail.groups[0]?.header.agent.name !== "opencode") {
    throw new Error(`real-session smoke found no embedded source usage\n${summary}`);
  }
  if (
    trail.groups[0]?.header.agent.name !== "claude-code" &&
    trail.groups[0]?.header.agent.name !== "opencode" &&
    checkedAnyTotal === 0
  ) {
    throw new Error(`real-session smoke found no source total token usage\n${summary}`);
  }
}
