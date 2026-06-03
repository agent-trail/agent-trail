import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { claudeCodeAdapter } from "./index.ts";
import { parseClaudeCodeEntries, parseClaudeCodeSnapshotEntries } from "./kit.ts";
import { INCLUDE_SIDECHAIN } from "./mappings.ts";
import { ccToolKindToResult } from "./reconcile-rules.ts";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/claude-code");
const entries = (fixture: string): Promise<Entry[]> =>
  parseClaudeCodeEntries(join(FIXTURES, fixture), "unit-test");

function writeTempJsonl(prefix: string, records: Record<string, unknown>[]): string {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  const path = join(tmp, "session.jsonl");
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return path;
}

describe("claude-code v2 stateful behaviors", () => {
  test("user_query_response preserves linker-derived call_id", () => {
    const out = ccToolKindToResult(
      [
        {
          type: "user_query",
          id: "query-1",
          ts: "2026-05-18T10:00:00.000Z",
          payload: { questions: [{ id: "ship", question: "Ship?" }] },
          meta: { linker: { call_id: "tooluse-question" } },
        },
        {
          type: "tool_result",
          id: "result-1",
          ts: "2026-05-18T10:00:01.000Z",
          payload: { ok: true, output: '"Ship?"="yes"' },
          meta: { linker: { call_id: "tooluse-question" } },
        },
      ] as Entry[],
      { agent: "claude-code" },
    );

    expect(out[1]?.type).toBe("user_query_response");
    expect(out[1]?.semantic).toEqual({ call_id: "tooluse-question" });
  });

  test("model_change synth: from/to + synthesized across a model switch", async () => {
    const all = await entries("interrupt-and-model-change.jsonl");
    const change = all.find((e) => e.type === "model_change");
    expect(change).toBeDefined();
    expect(change?.payload.from_model).toBe("claude-opus-4-7");
    expect(change?.payload.to_model).toBe("claude-sonnet-4-5");
    expect(change?.source?.synthesized).toBe(true);
    // hint stripped → no entry-level meta on the final entry
    expect(change?.meta).toBeUndefined();
  });

  test("permission_mode delta: from/to mode payload on the second change", async () => {
    const all = await entries("permission-mode.jsonl");
    const pms = all.filter((e) => e.type === "mode_change" && e.payload.scope === "permission");
    expect(pms).toHaveLength(2);
    expect(pms[0]?.ts).toBe("2026-05-18T10:00:00.000Z");
    expect(pms[0]?.payload).toEqual({
      scope: "permission",
      to_mode: "default",
      trigger: "initial",
    });
    expect(pms[1]?.ts).toBe("2026-05-18T10:00:02.000Z");
    expect(pms[1]?.payload).toEqual({
      scope: "permission",
      to_mode: "acceptEdits",
      from_mode: "default",
      trigger: "runtime_inferred",
    });
  });

  test("multi-block fanout: envelope_ref backfilled to the first block's entry id", async () => {
    const all = await entries("fidelity-edge-cases.jsonl");
    // find a multi-block entry carrying an envelope_ref (non-first block)
    const withRef = all.find((e) => {
      const raw = e.source?.raw;
      return raw !== undefined && "envelope_ref" in raw;
    });
    expect(withRef).toBeDefined();
    const ref = withRef?.source?.raw?.envelope_ref;
    expect(typeof ref).toBe("string");
    expect(ref).not.toBe(""); // backfilled to a real id, not the placeholder
    expect(all.some((e) => e.id === ref)).toBe(true);
  });

  test("summary fallback preserves structured message content as JSON text", async () => {
    const path = writeTempJsonl("cc-v2-summary-", [
      {
        type: "user",
        uuid: "00000000-0000-0000-0000-00000000aa01",
        parentUuid: null,
        timestamp: "2026-05-18T10:00:00.000Z",
        sessionId: "s",
        version: "1.0.0-synthetic",
        message: { role: "user", content: "hi" },
      },
      {
        type: "summary",
        uuid: "00000000-0000-0000-0000-00000000aa02",
        parentUuid: "00000000-0000-0000-0000-00000000aa01",
        timestamp: "2026-05-18T10:00:01.000Z",
        sessionId: "s",
        version: "1.0.0-synthetic",
        message: { content: [{ type: "text", text: "structured summary" }] },
      },
    ]);
    try {
      const all = await parseClaudeCodeEntries(path, "unit-test");
      const summary = all.find((e) => e.type === "session_summary");
      expect((summary?.payload as { text?: string }).text).toBe(
        '[{"type":"text","text":"structured summary"}]',
      );
    } finally {
      rmSync(dirname(path), { recursive: true, force: true });
    }
  });

  test("schema version comes from later tracer when first raw line is versionless", async () => {
    const path = writeTempJsonl("cc-v2-version-fallback-", [
      { type: "ai-title", aiTitle: "Versionless first line", sessionId: "s" },
      {
        type: "user",
        uuid: "00000000-0000-0000-0000-00000000dd01",
        parentUuid: null,
        timestamp: "2026-05-18T10:00:00.000Z",
        sessionId: "s",
        message: { role: "user", content: "hi" },
      },
      {
        type: "user",
        uuid: "00000000-0000-0000-0000-00000000dd02",
        parentUuid: "00000000-0000-0000-0000-00000000dd01",
        timestamp: "2026-05-18T10:00:01.000Z",
        sessionId: "s",
        version: "1.0.0-synthetic",
        message: { role: "user", content: "continue" },
      },
      {
        type: "totally-unknown-type",
        timestamp: "2026-05-18T10:00:02.000Z",
        sessionId: "s",
        version: "1.0.0-synthetic",
      },
    ]);
    try {
      const all = await parseClaudeCodeEntries(path, "unit-test");
      const quarantine = all.find(
        (e) =>
          e.type === "system_event" &&
          (e.payload as { kind?: string }).kind === "x-claudecode/unknown_record",
      );
      expect(quarantine).toBeDefined();
      expect((quarantine?.payload as { data?: { raw?: { type?: string } } }).data?.raw?.type).toBe(
        "totally-unknown-type",
      );
    } finally {
      rmSync(dirname(path), { recursive: true, force: true });
    }
  });

  test("parseClaudeCodeSnapshotEntries does not mutate caller records with sidechain markers", async () => {
    const records = [
      {
        type: "user",
        uuid: "00000000-0000-0000-0000-00000000ee01",
        parentUuid: null,
        timestamp: "2026-05-18T10:00:00.000Z",
        sessionId: "s",
        version: "1.0.0-synthetic",
        isSidechain: true,
        message: { role: "user", content: "hi" },
      },
    ];

    const all = await parseClaudeCodeSnapshotEntries(records, "unit-test", {
      includeSidechain: true,
    });

    expect(all.some((entry) => entry.type === "user_message")).toBe(true);
    expect(INCLUDE_SIDECHAIN in records[0]!).toBe(false);
  });

  test("parseSession wrapper emits session metadata update events", async () => {
    const path = writeTempJsonl("cc-v2-wrapper-", [
      {
        type: "user",
        uuid: "00000000-0000-0000-0000-00000000bb01",
        parentUuid: null,
        timestamp: "2026-05-18T10:00:00.000Z",
        sessionId: "s",
        version: "1.0.0-synthetic",
        cwd: "/this/path/does/not/exist",
        message: { role: "user", content: "hi" },
      },
      { type: "ai-title", aiTitle: "Wire v2 metadata", sessionId: "s" },
      { type: "agent-name", agentName: "wire-v2-metadata", sessionId: "s" },
      {
        type: "worktree-state",
        sessionId: "s",
        worktreeSession: {
          originalCwd: "/orig/repo",
          worktreePath: "/orig/repo/.worktrees/topic",
          worktreeName: "topic",
          worktreeBranch: "feature/topic",
          originalBranch: "main",
          originalHeadCommit: "abcdef0123456789abcdef0123456789abcdef01",
        },
      },
    ]);
    try {
      const trail = await claudeCodeAdapter.parseSession({
        id: "s",
        adapter: "claude-code",
        path,
      });
      expect(trail.envelope?.name).toBeUndefined();
      expect(trail.envelope?.meta).toBeUndefined();
      expect(trail.groups[0]!.header.vcs).toBeUndefined();
      const updates = trail.groups[0]!.entries.filter(
        (entry) => entry.type === "session_metadata_update",
      ).map((entry) => entry.payload);
      expect(updates).toEqual([
        { field: "name", value: "Wire v2 metadata", reason: "ai_generated" },
        {
          field: "x-claudecode/agent_name",
          value: "wire-v2-metadata",
          reason: "ai_generated",
        },
        { field: "vcs.branch", value: "feature/topic", reason: "runtime_inferred" },
        {
          field: "vcs.worktree",
          value: {
            name: "topic",
            path: "/orig/repo/.worktrees/topic",
            original_cwd: "/orig/repo",
            original_branch: "main",
            original_head_commit: "abcdef0123456789abcdef0123456789abcdef01",
          },
          reason: "runtime_inferred",
        },
      ]);
    } finally {
      rmSync(dirname(path), { recursive: true, force: true });
    }
  });

  test("strict reader throws on malformed JSONL instead of skipping lines", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cc-v2-malformed-"));
    const path = join(tmp, "session.jsonl");
    try {
      writeFileSync(
        path,
        `${JSON.stringify({
          type: "user",
          uuid: "00000000-0000-0000-0000-00000000cc01",
          parentUuid: null,
          timestamp: "2026-05-18T10:00:00.000Z",
          sessionId: "s",
          version: "1.0.0-synthetic",
          message: { role: "user", content: "hi" },
        })}\n{bad json}\n`,
      );
      await expect(parseClaudeCodeEntries(path, "unit-test")).rejects.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
