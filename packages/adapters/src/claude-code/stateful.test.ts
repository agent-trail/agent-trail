import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { claudeCodeAdapter } from "./index.ts";
import { parseClaudeCodeEntries } from "./kit.ts";

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

  test("permission_mode delta: from/to + delta text on the second change", async () => {
    const all = await entries("permission-mode.jsonl");
    const pms = all.filter(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "permission_mode_change",
    );
    expect(pms).toHaveLength(2);
    expect(pms[0]?.ts).toBe("2026-05-18T10:00:00.000Z");
    expect((pms[0]?.payload as { data?: { to?: string; from?: string } }).data).toEqual({
      to: "default",
    });
    expect(pms[0]?.payload.text).toBe("Permission mode: default");
    expect(pms[1]?.ts).toBe("2026-05-18T10:00:02.000Z");
    expect((pms[1]?.payload as { data?: { to?: string; from?: string } }).data).toEqual({
      to: "acceptEdits",
      from: "default",
    });
    expect(pms[1]?.payload.text).toBe("Permission mode changed: default → acceptEdits");
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

  test("parseSession wrapper preserves envelope metadata and worktree vcs hints", async () => {
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
      expect(trail.envelope?.name).toBe("Wire v2 metadata");
      expect(trail.envelope?.meta).toEqual({
        "x-claudecode/ai_title": "Wire v2 metadata",
        "x-claudecode/agent_name": "wire-v2-metadata",
      });
      expect(trail.header.vcs?.branch).toBe("feature/topic");
      expect(trail.header.vcs?.head_commit).toBe("abcdef0123456789abcdef0123456789abcdef01");
      expect(trail.header.vcs?.worktree).toEqual({
        name: "topic",
        path: "/orig/repo/.worktrees/topic",
        original_cwd: "/orig/repo",
        original_branch: "main",
        original_head_commit: "abcdef0123456789abcdef0123456789abcdef01",
      });
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
