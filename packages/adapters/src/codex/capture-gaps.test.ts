import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDiagnosticsText, validateWriterStrictRecord } from "@agent-trail/core";
import type { Entry, Header } from "@agent-trail/types";
import { codexAdapter } from "./index.ts";
import { parseCodexEntries } from "./kit.ts";
import { buildHeader, stableAxisKey, vcsFromGitInfo } from "./parser.ts";

// Synthetic JSONL exercising the #124 capture gaps. `git` is a sibling of the
// flattened SessionMeta fields inside the session_meta payload.
const SESSION_META = {
  timestamp: "2026-06-02T10:00:00.000Z",
  type: "session_meta",
  payload: {
    id: "019d8900-cccc-7000-e000-0000000000bb",
    cwd: "/repo",
    cli_version: "0.135.0",
    model_provider: "oss",
    base_instructions: { text: "be excellent" },
    memory_mode: "persistent",
    git: {
      commit_hash: "abc123def456",
      branch: "main",
      repository_url: "git@github.com:acme/repo.git",
    },
  },
};

const TURN_BASELINE = {
  timestamp: "2026-06-02T10:00:01.000Z",
  type: "turn_context",
  payload: {
    turn_id: "t1",
    model: "gpt-5-codex",
    approval_policy: "on-request",
    sandbox_policy: "workspace-write",
    active_permission_profile: "auto",
    personality: "concise",
    current_date: "2026-06-02",
    timezone: "UTC",
  },
};

const TURN_CHANGED = {
  timestamp: "2026-06-02T10:00:05.000Z",
  type: "turn_context",
  payload: {
    turn_id: "t2",
    model: "gpt-5-codex",
    approval_policy: "never",
    sandbox_policy: "danger-full-access",
    active_permission_profile: "full-access",
    personality: "verbose",
    current_date: "2026-06-02",
    timezone: "UTC",
  },
};

const REASONING = {
  timestamp: "2026-06-02T10:00:06.000Z",
  type: "response_item",
  payload: {
    type: "reasoning",
    summary: [{ text: "first section" }, { text: "second section" }],
  },
};

const SECTION_BREAK = {
  timestamp: "2026-06-02T10:00:07.000Z",
  type: "event_msg",
  payload: { type: "agent_reasoning_section_break", item_id: "r1", summary_index: 1 },
};

const EXEC_END = {
  timestamp: "2026-06-02T10:00:08.000Z",
  type: "event_msg",
  payload: {
    type: "exec_command_end",
    call_id: "c1",
    turn_id: "t2",
    completed_at_ms: 1717236008000,
    command: ["ls"],
    cwd: "/repo",
    exit_code: 0,
    duration: { secs: 1, nanos: 0 },
    stdout: "out",
    stderr: "",
    status: "completed",
    parsed_cmd: [],
  },
};

const RECORDS = [SESSION_META, TURN_BASELINE, TURN_CHANGED, REASONING, SECTION_BREAK, EXEC_END];

async function withFixture<T>(records: unknown[], fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "codex-124-"));
  const path = join(dir, "session.jsonl");
  await writeFile(path, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseHeader(): Promise<Header> {
  return withFixture(RECORDS, async (path) => {
    const trail = await codexAdapter.parseSession({
      id: SESSION_META.payload.id,
      adapter: "codex",
      path,
    });
    const header = trail.groups[0]?.header;
    if (header === undefined) throw new Error("no header");
    return header;
  });
}

function parseEntries(): Promise<Entry[]> {
  return withFixture(RECORDS, (path) => parseCodexEntries(path, "unit-124"));
}

describe("#124 — recorded git → header.vcs", () => {
  test("recorded git populates header.vcs (recorded wins; remote normalized)", async () => {
    const header = await parseHeader();
    expect(header.vcs).toEqual({
      type: "git",
      revision: "abc123def456",
      head_commit: "abc123def456",
      branch: "main",
      remote_url: "https://github.com/acme/repo",
    });
  });

  test("vcsFromGitInfo returns undefined without a commit hash", () => {
    expect(vcsFromGitInfo({ branch: "main" })).toBeUndefined();
    expect(vcsFromGitInfo(undefined)).toBeUndefined();
  });
});

describe("#124 — SessionMeta extras → header.meta", () => {
  test("model_provider, memory_mode, base_instructions fingerprint", async () => {
    const header = await parseHeader();
    expect(header.meta?.["dev.codex.model_provider"]).toBe("oss");
    expect(header.meta?.["dev.codex.memory_mode"]).toBe("persistent");
    const fp = header.meta?.["dev.codex.base_instructions"] as {
      sha256?: string;
      bytes?: number;
    };
    expect(fp?.bytes).toBe(Buffer.byteLength("be excellent", "utf8"));
    expect(fp?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("buildHeader uses envelope timestamp as canonical session ts", () => {
    const header = buildHeader({
      timestamp: "2026-06-02T10:00:00.000Z",
      type: "session_meta",
      payload: { id: SESSION_META.payload.id, timestamp: "1999-01-01T00:00:00.000Z" },
    });
    expect(header.ts).toBe("2026-06-02T10:00:00.000Z");
  });
});

describe("#124 — turn_context policy", () => {
  test("initial policy snapshot lands in header.meta", async () => {
    const header = await parseHeader();
    expect(header.meta?.["dev.codex.turn_context"]).toEqual({
      approval_policy: "on-request",
      sandbox_policy: "workspace-write",
      active_permission_profile: "auto",
      personality: "concise",
      current_date: "2026-06-02",
      timezone: "UTC",
    });
  });

  test("permission change → permission_mode_change (baseline emits nothing)", async () => {
    const all = await parseEntries();
    const perm = all.filter(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "permission_mode_change",
    );
    expect(perm).toHaveLength(1);
    const data = (perm[0]?.payload as { data?: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      to: "full-access",
      from: "auto",
      approval_policy: "never",
      sandbox_policy: "danger-full-access",
    });
  });

  test("flavor change → x-codex/turn_context", async () => {
    const all = await parseEntries();
    const flavor = all.filter(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "x-codex/turn_context",
    );
    expect(flavor).toHaveLength(1);
    expect((flavor[0]?.payload as { data?: { personality?: string } }).data?.personality).toBe(
      "verbose",
    );
  });

  test("model unchanged across turns → no model_change", async () => {
    const all = await parseEntries();
    expect(all.filter((e) => e.type === "model_change")).toHaveLength(0);
  });
});

describe("#124 — reasoning sections", () => {
  test("multi-section summary → one agent_thinking per section", async () => {
    const all = await parseEntries();
    const thinking = all.filter((e) => e.type === "agent_thinking");
    expect(thinking.map((e) => (e.payload as { text?: string }).text)).toEqual([
      "first section",
      "second section",
    ]);
  });

  test("agent_reasoning_section_break is dropped, not quarantined", async () => {
    const all = await parseEntries();
    expect(
      all.filter(
        (e) =>
          e.type === "system_event" &&
          String((e.payload as { kind?: string }).kind).endsWith("/unknown_record"),
      ),
    ).toHaveLength(0);
  });
});

describe("#124 — exec semantic time", () => {
  test("exec_command_end carries data.completed_at_ms; entry ts is envelope time", async () => {
    const all = await parseEntries();
    const exec = all.find(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "x-codex/exec_command_end",
    );
    expect((exec?.payload as { data?: { completed_at_ms?: number } }).data?.completed_at_ms).toBe(
      1717236008000,
    );
    expect(exec?.ts).toBe("2026-06-02T10:00:08.000Z");
  });
});

describe("#124 — change detection is key-order independent", () => {
  test("stableAxisKey canonicalizes nested objects (network) regardless of key order", () => {
    const a = stableAxisKey({
      approval_policy: "never",
      network: { allowed_domains: ["a.com"], denied_domains: ["b.com"] },
    });
    const b = stableAxisKey({
      network: { denied_domains: ["b.com"], allowed_domains: ["a.com"] },
      approval_policy: "never",
    });
    expect(a).toBe(b);
  });

  test("a turn_context that only reorders nested network keys emits no permission_mode_change", async () => {
    const records = [
      SESSION_META,
      {
        timestamp: "2026-06-02T10:00:01.000Z",
        type: "turn_context",
        payload: {
          turn_id: "t1",
          model: "gpt-5-codex",
          approval_policy: "on-request",
          network: { allowed_domains: ["a.com"], denied_domains: ["b.com"] },
        },
      },
      {
        timestamp: "2026-06-02T10:00:05.000Z",
        type: "turn_context",
        payload: {
          turn_id: "t2",
          model: "gpt-5-codex",
          approval_policy: "on-request",
          network: { denied_domains: ["b.com"], allowed_domains: ["a.com"] },
        },
      },
    ];
    const all = await withFixture(records, (path) => parseCodexEntries(path, "unit-124-net"));
    expect(
      all.filter(
        (e) =>
          e.type === "system_event" &&
          (e.payload as { kind?: string }).kind === "permission_mode_change",
      ),
    ).toHaveLength(0);
  });
});

describe("#124 — snapshot skips non-emittable baseline", () => {
  test("timestamp-less first turn_context is not snapshotted into header.meta", async () => {
    const records = [
      SESSION_META,
      {
        // no timestamp → the override skips it; the header snapshot must too.
        type: "turn_context",
        payload: { turn_id: "t1", approval_policy: "on-request", sandbox_policy: "read-only" },
      },
    ];
    const header = await withFixture(records, async (path) => {
      const trail = await codexAdapter.parseSession({
        id: SESSION_META.payload.id,
        adapter: "codex",
        path,
      });
      return trail.groups[0]?.header;
    });
    expect(header?.meta?.["dev.codex.turn_context"]).toBeUndefined();
  });

  test("first emittable turn_context becomes the snapshot when an earlier one is timestamp-less", async () => {
    const records = [
      SESSION_META,
      {
        type: "turn_context",
        payload: { turn_id: "t1", approval_policy: "on-request", sandbox_policy: "read-only" },
      },
      {
        timestamp: "2026-06-02T10:00:05.000Z",
        type: "turn_context",
        payload: { turn_id: "t2", approval_policy: "never", sandbox_policy: "danger-full-access" },
      },
    ];
    const header = await withFixture(records, async (path) => {
      const trail = await codexAdapter.parseSession({
        id: SESSION_META.payload.id,
        adapter: "codex",
        path,
      });
      return trail.groups[0]?.header;
    });
    expect(header?.meta?.["dev.codex.turn_context"]).toEqual({
      approval_policy: "never",
      sandbox_policy: "danger-full-access",
    });
  });
});

describe("#124 — reasoning dedup across both channels (bug #2)", () => {
  test("a summary section duplicating an event_msg reasoning is folded; divergent sections survive", async () => {
    const records = [
      SESSION_META,
      TURN_BASELINE,
      {
        timestamp: "2026-06-02T10:00:06.000Z",
        type: "event_msg",
        payload: { type: "agent_reasoning", text: "shared thought" },
      },
      {
        timestamp: "2026-06-02T10:00:06.500Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ text: "shared thought" }, { text: "unique section" }],
        },
      },
    ];
    const all = await withFixture(records, (path) => parseCodexEntries(path, "unit-124-dedup"));
    const thinking = all.filter((e) => e.type === "agent_thinking");
    // "shared thought" emitted once (from the event_msg channel); the matching
    // summary section is folded; the divergent "unique section" still emits.
    expect(thinking.map((e) => (e.payload as { text?: string }).text)).toEqual([
      "shared thought",
      "unique section",
    ]);
  });
});

describe("#124 — permission mode label fallback", () => {
  test("with no preset, permission_mode_change to/from use approval_policy", async () => {
    const records = [
      SESSION_META,
      {
        timestamp: "2026-06-02T10:00:01.000Z",
        type: "turn_context",
        payload: { turn_id: "t1", approval_policy: "on-request", sandbox_policy: "read-only" },
      },
      {
        timestamp: "2026-06-02T10:00:05.000Z",
        type: "turn_context",
        payload: { turn_id: "t2", approval_policy: "never", sandbox_policy: "read-only" },
      },
    ];
    const all = await withFixture(records, (path) => parseCodexEntries(path, "unit-124-label"));
    const perm = all.filter(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "permission_mode_change",
    );
    expect(perm).toHaveLength(1);
    expect((perm[0]?.payload as { data?: Record<string, unknown> }).data).toMatchObject({
      to: "never",
      from: "on-request",
    });
  });
});

describe("#124 — header.meta hygiene", () => {
  test("base_instructions as a plain string is still fingerprinted", () => {
    const header = buildHeader({
      timestamp: "2026-06-02T10:00:00.000Z",
      type: "session_meta",
      payload: { id: SESSION_META.payload.id, base_instructions: "raw prompt" },
    });
    const fp = header.meta?.["dev.codex.base_instructions"] as { sha256?: string; bytes?: number };
    expect(fp?.bytes).toBe(Buffer.byteLength("raw prompt", "utf8"));
    expect(fp?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("no SessionMeta extras → header.meta stays absent", () => {
    const header = buildHeader({
      timestamp: "2026-06-02T10:00:00.000Z",
      type: "session_meta",
      payload: { id: SESSION_META.payload.id },
    });
    expect(header.meta).toBeUndefined();
  });

  test("vcsFromGitInfo with only a commit hash yields a minimal git block", () => {
    expect(vcsFromGitInfo({ commit_hash: "deadbeef" })).toEqual({
      type: "git",
      revision: "deadbeef",
      head_commit: "deadbeef",
    });
  });
});

describe("#124 — all emitted entries are writer-strict valid", () => {
  test("entries validate", async () => {
    const all = await parseEntries();
    for (const [index, entry] of all.entries()) {
      expect(
        formatDiagnosticsText(
          validateWriterStrictRecord({ line: index + 2, raw: JSON.stringify(entry), value: entry }),
        ),
      ).toBe("");
    }
  });
});
