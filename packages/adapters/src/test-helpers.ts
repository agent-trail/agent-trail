import { expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
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
  expectedAgentName: string;
  testName: string;
  fallbackSessionId: string;
  defaultSessionPath?: () => string | undefined;
  resolveSessionPath?: (path: string) => string | undefined;
  assertTrail?: (trail: TrailFile, summary: string) => void | Promise<void>;
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
    await options.assertTrail?.(trail, summary);
  });
}
