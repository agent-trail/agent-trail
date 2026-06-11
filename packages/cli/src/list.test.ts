import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import type { DetectOptions, SessionRef, TrailAdapter, TrailFile } from "@agent-trail/adapters";
import { canonicalizeRecords, computeContentHash, parseJsonlString } from "@agent-trail/core";
import { objectPath, registerTrail } from "@agent-trail/store";
import { runCli } from "./cli-runtime.ts";
import type { ResolvedConfig } from "./config.ts";
import { parseShareJson, runList, runListBrowser, spawnResumeCommand } from "./list.ts";

type SeedOpts = {
  agentName?: string;
  cwd?: string;
  id?: string;
  name?: string;
  firstText?: string;
};

type HeaderAgentName = TrailFile["groups"][number]["header"]["agent"]["name"];

async function seedTrail(opts: SeedOpts = {}): Promise<{ filePath: string; contentHash: string }> {
  const agentName = opts.agentName ?? "codex-cli";
  const cwd = opts.cwd ?? "/work/proj-a";
  const id = opts.id ?? "01HSESS0000000000000000001";
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id,
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: agentName },
    cwd,
  };
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: opts.firstText ?? "hello" },
  };
  const records = [
    header,
    ...(opts.name === undefined
      ? []
      : [
          {
            type: "session_metadata_update",
            id: "01HEVTA0000000000000000000",
            ts: "2026-05-17T14:00:01.000Z",
            payload: { field: "name", value: opts.name, reason: "external" },
          },
        ]),
    userMsg,
  ];
  const draftBytes = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const draftRecords = await parseJsonlString(draftBytes);
  const contentHash = computeContentHash(draftRecords);
  header.content_hash = contentHash;
  const finalBytes = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const finalRecords = await parseJsonlString(finalBytes);
  const canonical = canonicalizeRecords(finalRecords);

  const dir = mkdtempSync(join(tmpdir(), "trail-cli-list-input-"));
  const filePath = join(dir, "session.trail.jsonl");
  await writeFile(filePath, canonical, "utf8");
  return { filePath, contentHash };
}

async function overrideRegisteredAt(
  storeRoot: string,
  patches: Record<string, string>,
): Promise<void> {
  const indexPath = join(storeRoot, "index", "objects.json");
  const raw = await readFile(indexPath, "utf8");
  const idx = JSON.parse(raw) as {
    version: number;
    entries: Record<string, { registered_at: string; source_path: string | null }>;
  };
  for (const [hash, ts] of Object.entries(patches)) {
    const entry = idx.entries[hash];
    if (entry !== undefined) entry.registered_at = ts;
  }
  await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");
}

function resolvedConfig(defaultFilter: string | null): ResolvedConfig {
  return {
    config: {
      sources: { defaultFilter },
      tui: { previewByteCap: 65_536, previewEventCap: 500 },
      keymap: {},
    },
    sources: [],
  };
}

function stubAdapter(name: string, refs: SessionRef[]): TrailAdapter {
  return {
    name,
    async detectSessions() {
      return refs;
    },
    async parseSession(): Promise<TrailFile> {
      throw new Error("not needed");
    },
    async isAvailable() {
      return true;
    },
    async sourceVersion() {
      return null;
    },
    async sourceHealth() {
      return {
        adapter: name,
        path: null,
        present: true,
        readable: true,
        sessionCount: refs.length,
        sourceVersion: null,
        warnings: [],
      };
    },
  };
}

function parseableAdapter(name: string, refs: SessionRef[]): TrailAdapter {
  const agentName = (name === "codex" ? "codex-cli" : name) as HeaderAgentName;
  return {
    ...stubAdapter(name, refs),
    async parseSession(ref): Promise<TrailFile> {
      return {
        groups: [
          {
            header: {
              type: "session",
              schema_version: "0.1.0",
              id: "01HSESS0000000000000000001",
              ts: "2026-05-17T14:00:00.000Z",
              agent: { name: agentName },
              cwd: ref.cwd,
            },
            entries: [
              {
                type: "user_message",
                id: "01HEVTA0000000000000000001",
                ts: "2026-05-17T14:00:05.000Z",
                payload: { text: "source action trail" },
              },
            ],
          },
        ],
      };
    },
  };
}

function resumableAdapter(name: string, refs: SessionRef[]): TrailAdapter {
  return {
    ...parseableAdapter(name, refs),
    async resumeSession(ref) {
      return {
        supported: true,
        command: {
          label: `Resume ${name} ${ref.id}`,
          argv: [name, "--session", ref.id],
          cwd: ref.cwd,
          env: { AGENT_TRAIL_TEST: "1" },
        },
      };
    },
  };
}

function cwdFilteringResumableAdapter(name: string, refs: SessionRef[]): TrailAdapter {
  return {
    ...resumableAdapter(name, refs),
    async detectSessions(opts?: DetectOptions) {
      if (opts?.allCwds === true) return refs;
      const cwd = opts?.cwd ?? process.cwd();
      return refs.filter((ref) => ref.cwd === undefined || ref.cwd === cwd);
    },
  };
}

function throwingAdapter(name: string, message: string): TrailAdapter {
  return {
    name,
    async detectSessions() {
      throw new Error(message);
    },
    async parseSession(): Promise<TrailFile> {
      throw new Error("not needed");
    },
    async isAvailable() {
      return true;
    },
    async sourceVersion() {
      return null;
    },
    async sourceHealth() {
      return {
        adapter: name,
        path: null,
        present: true,
        readable: true,
        sessionCount: 0,
        sourceVersion: null,
        warnings: [],
      };
    },
  };
}

let storeRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-cli-list-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

test("empty store: exits 0 with empty stdout and stderr", async () => {
  const result = await runList({}, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
});

test("source-only session: --json emits unified source row", async () => {
  const result = await runList(
    { json: true },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-source",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-17T14:00:00.000Z",
            path: "/tmp/source-session.jsonl",
          },
        ]),
      ],
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout);
  expect(parsed).toEqual([
    {
      state: "source",
      source_id: "sess-source",
      source_agent: "codex",
      source_cwd: process.cwd(),
      source_modified_at: "2026-05-17T14:00:00.000Z",
      source_path: "/tmp/source-session.jsonl",
      content_hash: null,
      registered_agent: null,
      registered_cwd: null,
      registered_at: null,
      registered_source_path: null,
      registered_kind: null,
      agent: "codex",
      cwd: process.cwd(),
      latest_at: "2026-05-17T14:00:00.000Z",
    },
  ]);
});

test("source discovery defaults to current cwd", async () => {
  const result = await runList(
    { json: true },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-here",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-17T14:00:00.000Z",
          },
          {
            id: "sess-other",
            adapter: "codex",
            cwd: "/work/other",
            modifiedAt: "2026-05-18T14:00:00.000Z",
          },
        ]),
      ],
    },
  );

  const parsed = JSON.parse(result.stdout) as Array<{ source_id: string }>;
  expect(parsed.map((r) => r.source_id)).toEqual(["sess-here"]);
});

test("omitted --cwd scopes source discovery but not registered store rows", async () => {
  const registered = await seedTrail({
    id: "01HSESS00000000000000CWD01",
    cwd: "/work/registered-other",
  });
  await registerTrail(registered.filePath, { storeRoot });

  const result = await runList(
    { json: true },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-here",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-17T14:00:00.000Z",
          },
          {
            id: "sess-other",
            adapter: "codex",
            cwd: "/work/source-other",
            modifiedAt: "2026-05-18T14:00:00.000Z",
          },
        ]),
      ],
    },
  );

  const parsed = JSON.parse(result.stdout) as Array<{
    content_hash: string | null;
    source_id: string | null;
  }>;
  expect(parsed).toContainEqual(expect.objectContaining({ source_id: "sess-here" }));
  expect(parsed).not.toContainEqual(expect.objectContaining({ source_id: "sess-other" }));
  expect(parsed).toContainEqual(expect.objectContaining({ content_hash: registered.contentHash }));
});

test("collapses source and registered rows by exact source path", async () => {
  const { filePath, contentHash } = await seedTrail({
    id: "01HSESS00000000000000C01AA",
    cwd: "/work/collapsed",
  });
  const reg = await registerTrail(filePath, { storeRoot, sourcePath: filePath });
  expect(reg.status).toBe("finalized");
  await overrideRegisteredAt(storeRoot, { [contentHash]: "2026-05-17T14:00:00.000Z" });

  const result = await runList(
    { json: true, cwd: "/work/collapsed" },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-collapsed",
            adapter: "codex",
            cwd: "/work/collapsed",
            modifiedAt: "2026-05-18T14:00:00.000Z",
            path: filePath,
          },
        ]),
      ],
    },
  );

  const parsed = JSON.parse(result.stdout);
  expect(parsed).toHaveLength(1);
  expect(parsed[0]).toEqual(
    expect.objectContaining({
      state: "source+registered",
      source_id: "sess-collapsed",
      content_hash: contentHash,
      agent: "codex",
      cwd: "/work/collapsed",
      latest_at: "2026-05-18T14:00:00.000Z",
    }),
  );
});

test("collapsed rows use the newer source or registered timestamp as latest_at", async () => {
  const { filePath, contentHash } = await seedTrail({
    id: "01HSESS00000000000000C02AA",
    cwd: "/work/latest",
  });
  await registerTrail(filePath, { storeRoot, sourcePath: filePath });
  await overrideRegisteredAt(storeRoot, { [contentHash]: "2026-05-19T14:00:00.000Z" });

  const result = await runList(
    { json: true, cwd: "/work/latest" },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-latest",
            adapter: "codex",
            cwd: "/work/latest",
            modifiedAt: "2026-05-18T14:00:00.000Z",
            path: filePath,
          },
        ]),
      ],
    },
  );

  const parsed = JSON.parse(result.stdout) as Array<{ latest_at: string }>;
  expect(parsed[0]?.latest_at).toBe("2026-05-19T14:00:00.000Z");
});

test("duplicate registered source paths collapse to the newest source-backed row", async () => {
  const first = await seedTrail({ id: "01HSESS00000000000000D0101", cwd: "/work/dupe" });
  const second = await seedTrail({ id: "01HSESS00000000000000D0102", cwd: "/work/dupe" });
  await registerTrail(first.filePath, { storeRoot, sourcePath: first.filePath });
  await registerTrail(second.filePath, { storeRoot, sourcePath: first.filePath });
  await overrideRegisteredAt(storeRoot, {
    [first.contentHash]: "2026-05-17T14:00:00.000Z",
    [second.contentHash]: "2026-05-19T14:00:00.000Z",
  });

  const result = await runList(
    { json: true, cwd: "/work/dupe" },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-dupe",
            adapter: "codex",
            cwd: "/work/dupe",
            modifiedAt: "2026-05-18T14:00:00.000Z",
            path: first.filePath,
          },
        ]),
      ],
    },
  );

  const parsed = JSON.parse(result.stdout) as Array<{ state: string; content_hash: string | null }>;
  expect(parsed).toEqual([
    expect.objectContaining({ state: "source+registered", content_hash: second.contentHash }),
  ]);
});

test("source rows hide trail objects backed by the same source path", async () => {
  const source = await seedTrail({ id: "01HSESS00000000000000D0201", cwd: "/work/source-backed" });
  await registerTrail(source.filePath, { storeRoot, sourcePath: source.filePath });
  const trailHash = "c".repeat(64);
  mkdirSync(dirname(objectPath(storeRoot, trailHash)), { recursive: true });
  await writeFile(
    objectPath(storeRoot, trailHash),
    await readFile(source.filePath, "utf8"),
    "utf8",
  );
  await writeFile(
    join(storeRoot, "index", "objects.json"),
    JSON.stringify(
      {
        version: 1,
        entries: {
          [source.contentHash]: {
            registered_at: "2026-05-17T14:00:00.000Z",
            source_path: source.filePath,
            kind: "session",
          },
          [trailHash]: {
            registered_at: "2026-05-19T14:00:00.000Z",
            source_path: source.filePath,
            kind: "trail",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await overrideRegisteredAt(storeRoot, {
    [source.contentHash]: "2026-05-17T14:00:00.000Z",
    [trailHash]: "2026-05-19T14:00:00.000Z",
  });

  const result = await runList(
    { json: true, cwd: "/work/source-backed" },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-source-backed",
            adapter: "codex",
            cwd: "/work/source-backed",
            modifiedAt: "2026-05-18T14:00:00.000Z",
            path: source.filePath,
          },
        ]),
      ],
    },
  );

  const parsed = JSON.parse(result.stdout) as Array<{
    state: string;
    content_hash: string | null;
    source_id: string | null;
  }>;
  expect(parsed).toEqual([
    expect.objectContaining({
      state: "source+registered",
      source_id: "sess-source-backed",
      content_hash: trailHash,
    }),
  ]);
});

test("--source filters source-side and registered-side rows", async () => {
  const registered = await seedTrail({
    id: "01HSESS00000000000000REGAA",
    cwd: "/work/registered",
  });
  await registerTrail(registered.filePath, { storeRoot });
  const adapters = [
    stubAdapter("codex", [
      {
        id: "sess-source",
        adapter: "codex",
        cwd: process.cwd(),
        modifiedAt: "2026-05-18T14:00:00.000Z",
      },
    ]),
  ];

  const source = await runList({ json: true, source: "source" }, { storeRoot, adapters });
  const sourceRows = JSON.parse(source.stdout) as Array<{ state: string }>;
  expect(sourceRows.map((r) => r.state)).toEqual(["source"]);

  const registeredOnly = await runList(
    { json: true, source: "registered" },
    { storeRoot, adapters },
  );
  const registeredRows = JSON.parse(registeredOnly.stdout) as Array<{
    state: string;
    content_hash: string | null;
  }>;
  expect(registeredRows).toEqual([
    expect.objectContaining({ state: "registered", content_hash: registered.contentHash }),
  ]);
});

test("sorts unified rows by latest_at desc and --limit truncates with warning", async () => {
  const result = await runList(
    { json: true, limit: "2" },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-oldest",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-17T14:00:00.000Z",
          },
          {
            id: "sess-newest",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-19T14:00:00.000Z",
          },
          {
            id: "sess-middle",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-18T14:00:00.000Z",
          },
        ]),
      ],
    },
  );

  expect(result.stderr).toBe("warning: 3 rows matched; showing first 2\n");
  const parsed = JSON.parse(result.stdout) as Array<{ source_id: string }>;
  expect(parsed.map((r) => r.source_id)).toEqual(["sess-newest", "sess-middle"]);
});

test("--json and --plain together exits 1", async () => {
  const result = await runList({ json: true, plain: true }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("error: --json and --plain cannot be used together\n");
});

test("--agent codex-cli matches codex source adapter alias", async () => {
  const result = await runList(
    { json: true, agent: "codex-cli" },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-codex-alias",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-17T14:00:00.000Z",
          },
        ]),
      ],
    },
  );

  const parsed = JSON.parse(result.stdout) as Array<{ source_id: string }>;
  expect(parsed.map((r) => r.source_id)).toEqual(["sess-codex-alias"]);
});

test("--search matches source head content and respects --case-sensitive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trail-cli-list-search-"));
  const sourcePath = join(dir, "session.jsonl");
  await writeFile(sourcePath, JSON.stringify({ text: "Debugged a Race Condition" }), "utf8");
  const adapters = [
    stubAdapter("codex", [
      {
        id: "sess-search",
        adapter: "codex",
        cwd: process.cwd(),
        modifiedAt: "2026-05-17T14:00:00.000Z",
        path: sourcePath,
      },
    ]),
  ];

  const insensitive = await runList(
    { json: true, search: "race condition" },
    { storeRoot, adapters },
  );
  expect(
    (JSON.parse(insensitive.stdout) as Array<{ source_id: string }>).map((r) => r.source_id),
  ).toEqual(["sess-search"]);

  const sensitive = await runList(
    { json: true, search: "race condition", caseSensitive: true },
    { storeRoot, adapters },
  );
  expect(JSON.parse(sensitive.stdout)).toEqual([]);

  rmSync(dir, { recursive: true, force: true });
});

test("--search matches registered object head content", async () => {
  const { filePath, contentHash } = await seedTrail({
    id: "01HSESS00000000000000SRC01",
    cwd: "/work/search-registered",
  });
  await registerTrail(filePath, { storeRoot });

  const matched = await runList(
    { json: true, search: "hello", cwd: "/work/search-registered" },
    { storeRoot, adapters: [] },
  );
  const matchedRows = JSON.parse(matched.stdout) as Array<{ content_hash: string }>;
  expect(matchedRows.map((r) => r.content_hash)).toEqual([contentHash]);

  const missed = await runList(
    { json: true, search: "not in object", cwd: "/work/search-registered" },
    { storeRoot, adapters: [] },
  );
  expect(JSON.parse(missed.stdout)).toEqual([]);
});

test("source adapter failures warn and do not abort listing", async () => {
  const result = await runList(
    { json: true },
    {
      storeRoot,
      adapters: [
        throwingAdapter("broken", "cannot scan"),
        stubAdapter("codex", [
          {
            id: "sess-ok",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-17T14:00:00.000Z",
          },
        ]),
      ],
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("warning: broken detectSessions failed: cannot scan");
  const parsed = JSON.parse(result.stdout) as Array<{ source_id: string }>;
  expect(parsed.map((r) => r.source_id)).toEqual(["sess-ok"]);
});

test("single registered trail prints one text row with short hash, agent, cwd, registered_at", async () => {
  const { filePath, contentHash } = await seedTrail({
    agentName: "codex-cli",
    cwd: "/work/proj-a",
  });
  const reg = await registerTrail(filePath, { storeRoot });
  expect(reg.status).toBe("finalized");

  const result = await runList({}, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const lines = result.stdout.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  const row = lines[0] as string;
  expect(row).toContain(contentHash.slice(0, 12));
  expect(row).toContain("codex-cli");
  expect(row).toContain("/work/proj-a");
  expect(row).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test("--json: emits a JSON array of entries with full shape", async () => {
  const { filePath, contentHash } = await seedTrail({
    agentName: "claude-code",
    cwd: "/work/proj-b",
  });
  const reg = await registerTrail(filePath, { storeRoot });
  expect(reg.status).toBe("finalized");

  const result = await runList({ json: true }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed).toHaveLength(1);
  expect(parsed[0]).toEqual(
    expect.objectContaining({
      content_hash: contentHash,
      agent: "claude-code",
      cwd: "/work/proj-b",
      registered_source_path: filePath,
    }),
  );
  expect(typeof parsed[0].registered_at).toBe("string");
});

test("sorts by registered_at desc (newest first)", async () => {
  const older = await seedTrail({ id: "01HSESS00000000000000DD0AA", cwd: "/work/old" });
  const newer = await seedTrail({ id: "01HSESS0000000000000NEW0AA", cwd: "/work/new" });
  await registerTrail(older.filePath, { storeRoot });
  await registerTrail(newer.filePath, { storeRoot });
  await overrideRegisteredAt(storeRoot, {
    [older.contentHash]: "2026-01-01T00:00:00.000Z",
    [newer.contentHash]: "2026-02-01T00:00:00.000Z",
  });

  const result = await runList({ json: true }, { storeRoot, adapters: [] });

  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string }>;
  expect(parsed.map((r) => r.content_hash)).toEqual([newer.contentHash, older.contentHash]);
});

test("--agent filters by exact agent name", async () => {
  const codex = await seedTrail({
    id: "01HSESS0000000000000000AAA",
    agentName: "codex-cli",
    cwd: "/work/a",
  });
  const claude = await seedTrail({
    id: "01HSESS0000000000000000ABB",
    agentName: "claude-code",
    cwd: "/work/b",
  });
  await registerTrail(codex.filePath, { storeRoot });
  await registerTrail(claude.filePath, { storeRoot });

  const result = await runList({ json: true, agent: "claude-code" }, { storeRoot, adapters: [] });

  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; agent: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(claude.contentHash);
  expect(parsed[0]?.agent).toBe("claude-code");
});

test("resolved config default source filter applies through runCli list", async () => {
  const codex = await seedTrail({
    id: "01HSESS0000000000000000AAA",
    agentName: "codex-cli",
    cwd: "/work/a",
  });
  const pi = await seedTrail({
    id: "01HSESS0000000000000000ABB",
    agentName: "pi",
    cwd: "/work/b",
  });
  await registerTrail(codex.filePath, { storeRoot });
  await registerTrail(pi.filePath, { storeRoot });

  const result = await runCli(["list", "--json"], {
    config: resolvedConfig("pi"),
    adapters: [],
    storeRoot,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; agent: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(pi.contentHash);
  expect(parsed[0]?.agent).toBe("pi");
});

test("runCli list uses injected adapters", async () => {
  const result = await runCli(["list", "--json"], {
    config: resolvedConfig(null),
    adapters: [
      stubAdapter("codex", [
        {
          id: "sess-runcli-list",
          adapter: "codex",
          cwd: process.cwd(),
          modifiedAt: "2026-05-17T14:00:00.000Z",
        },
      ]),
    ],
    storeRoot,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as Array<{ source_id: string }>;
  expect(parsed.map((r) => r.source_id)).toEqual(["sess-runcli-list"]);
});

test("runCli list opens TUI in TTY", async () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "trail-cli-list-source-"));
  const sourcePath = join(sourceDir, "source-session.jsonl");
  await writeFile(
    sourcePath,
    `${JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "first source prompt from codex" },
    })}\n`,
    "utf8",
  );
  let launched = false;
  try {
    const result = await runCli(["list"], {
      config: resolvedConfig(null),
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-tui",
            adapter: "codex",
            cwd: process.cwd(),
            modifiedAt: "2026-05-17T14:00:00.000Z",
            path: sourcePath,
          },
        ]),
      ],
      storeRoot,
      terminal: { isTTY: true },
      runSessionBrowser: async ({ rows, scope }) => {
        launched = true;
        expect(rows.map((row) => row.source_id)).toEqual(["sess-tui"]);
        expect(rows[0]?.display_name).toBe("first source prompt from codex");
        expect(scope?.mode).toBe("cwd");
        expect(scope?.label).toBe(process.cwd().split("/").pop());
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(launched).toBe(true);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  } finally {
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("runListBrowser prefers registered trail name for TUI rows", async () => {
  const { filePath } = await seedTrail({ name: "Saved Trail Name", firstText: "fallback text" });
  await registerTrail(filePath, { storeRoot });

  let launched = false;
  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [],
      storeRoot,
      defaultCwd: "/work/proj-a",
      terminal: { isTTY: true },
      runSessionBrowser: async ({ rows }) => {
        launched = true;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.display_name).toBe("Saved Trail Name");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(launched).toBe(true);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runListBrowser share action registers source row before sharing", async () => {
  const refs: SessionRef[] = [
    {
      id: "sess-share-source",
      adapter: "codex",
      cwd: "/work/actions",
      modifiedAt: "2026-05-17T14:00:00.000Z",
      path: "/tmp/source-action.jsonl",
    },
  ];
  const uploaded: string[] = [];
  let launched = false;

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [parseableAdapter("codex", refs)],
      storeRoot,
      defaultCwd: "/work/actions",
      terminal: { isTTY: true },
      confirmShare: async () => true,
      gistUpload: async (_payload, filename) => {
        uploaded.push(filename);
        return { gistId: "tuishareid" };
      },
      runSessionBrowser: async (input) => {
        launched = true;
        const row = input.rows[0];
        expect(row?.state).toBe("source");
        const shared = await input.onShare?.(row!);
        expect(shared?.url).toBe("https://agent-trail.dev/view/gist/tuishareid");
        expect(shared?.rows?.[0]?.state).toBe("source+registered");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(launched).toBe(true);
  expect(uploaded).toHaveLength(1);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runListBrowser resume action spawns adapter command for source rows", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "trail-resume-cwd-"));
  const refs: SessionRef[] = [
    {
      id: "sess-resume-source",
      adapter: "codex",
      cwd,
      modifiedAt: "2026-05-17T14:00:00.000Z",
      path: "/tmp/source-action.jsonl",
    },
  ];
  let launched = false;
  const spawned: unknown[] = [];

  try {
    const result = await runListBrowser(
      {},
      {
        config: resolvedConfig(null),
        adapters: [resumableAdapter("codex", refs)],
        storeRoot,
        defaultCwd: cwd,
        terminal: { isTTY: true },
        resumeRunner: async (command) => {
          spawned.push(command);
          return { exitCode: 42, stdout: "", stderr: "child exited 42\n" };
        },
        runSessionBrowser: async (input) => {
          launched = true;
          const row = input.rows[0];
          const resumed = await input.onResume?.(row!);
          expect(resumed).toEqual({ exitCode: 42, stdout: "", stderr: "child exited 42\n" });
          return resumed!;
        },
      },
    );

    expect(launched).toBe(true);
    expect(spawned).toEqual([
      {
        label: "Resume codex sess-resume-source",
        argv: ["codex", "--session", "sess-resume-source"],
        cwd,
        env: { AGENT_TRAIL_TEST: "1" },
      },
    ]);
    expect(result).toEqual({ exitCode: 42, stdout: "", stderr: "child exited 42\n" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runListBrowser resume action rejects registered-only rows", async () => {
  const { filePath } = await seedTrail({ cwd: "/work/actions" });
  await registerTrail(filePath, { storeRoot });
  let launched = false;
  let spawnCount = 0;

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [],
      storeRoot,
      defaultCwd: "/work/actions",
      terminal: { isTTY: true },
      resumeRunner: async () => {
        spawnCount += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      runSessionBrowser: async (input) => {
        launched = true;
        const row = input.rows[0];
        await expect(input.onResume?.(row!)).rejects.toThrow("no adapter available for codex-cli");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(launched).toBe(true);
  expect(spawnCount).toBe(0);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runListBrowser resume action recovers registered source rows by source path", async () => {
  const sourceCwd = mkdtempSync(join(tmpdir(), "trail-resume-source-cwd-"));
  const browserCwd = mkdtempSync(join(tmpdir(), "trail-resume-browser-cwd-"));
  const { filePath } = await seedTrail({
    agentName: "codex-cli",
    cwd: browserCwd,
  });
  await registerTrail(filePath, { storeRoot, sourcePath: filePath });
  const refs: SessionRef[] = [
    {
      id: "sess-resume-outside-cwd",
      adapter: "codex",
      cwd: sourceCwd,
      modifiedAt: "2026-05-17T14:00:00.000Z",
      path: filePath,
    },
  ];
  const spawned: unknown[] = [];

  try {
    const result = await runListBrowser(
      {},
      {
        config: resolvedConfig(null),
        adapters: [cwdFilteringResumableAdapter("codex", refs)],
        storeRoot,
        defaultCwd: browserCwd,
        terminal: { isTTY: true },
        resumeRunner: async (command) => {
          spawned.push(command);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        runSessionBrowser: async (input) => {
          const row = input.rows[0];
          expect(row?.state).toBe("registered");
          expect(row?.registered_source_path).toBe(filePath);
          const resumed = await input.onResume?.(row!);
          expect(resumed).toEqual({ exitCode: 0, stdout: "", stderr: "" });
          return resumed!;
        },
      },
    );

    expect(spawned).toEqual([
      {
        label: "Resume codex sess-resume-outside-cwd",
        argv: ["codex", "--session", "sess-resume-outside-cwd"],
        cwd: sourceCwd,
        env: { AGENT_TRAIL_TEST: "1" },
      },
    ]);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  } finally {
    rmSync(sourceCwd, { recursive: true, force: true });
    rmSync(browserCwd, { recursive: true, force: true });
  }
});

test("spawnResumeCommand fails before spawn when cwd is missing", async () => {
  const parent = mkdtempSync(join(tmpdir(), "trail-missing-resume-cwd-"));
  const missingCwd = join(parent, "gone");
  try {
    const result = await spawnResumeCommand({
      label: "Resume missing cwd",
      argv: ["definitely-not-run"],
      cwd: missingCwd,
    });

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `Resume failed: cwd does not exist: ${missingCwd}\n`,
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("runListBrowser resume action reports missing cwd without handoff", async () => {
  const parent = mkdtempSync(join(tmpdir(), "trail-missing-browser-resume-cwd-"));
  const missingCwd = join(parent, "gone");
  const refs: SessionRef[] = [
    {
      id: "sess-missing-cwd",
      adapter: "codex",
      cwd: missingCwd,
      modifiedAt: "2026-05-17T14:00:00.000Z",
      path: "/tmp/source-action.jsonl",
    },
  ];
  let handoffStarted = false;
  let spawnCount = 0;
  try {
    const result = await runListBrowser(
      {},
      {
        config: resolvedConfig(null),
        adapters: [resumableAdapter("codex", refs)],
        storeRoot,
        defaultCwd: missingCwd,
        terminal: { isTTY: true },
        resumeRunner: async () => {
          spawnCount += 1;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        runSessionBrowser: async (input) => {
          const row = input.rows[0];
          await expect(
            input.onResume?.(row!, {
              beforeSpawn: () => {
                handoffStarted = true;
              },
            }),
          ).rejects.toThrow(`cwd does not exist: ${missingCwd}`);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(handoffStarted).toBe(false);
    expect(spawnCount).toBe(0);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("runListBrowser share action reuses registered hash", async () => {
  const { filePath, contentHash } = await seedTrail({ cwd: "/work/actions" });
  await registerTrail(filePath, { storeRoot });
  let launched = false;
  const filenames: string[] = [];

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [],
      storeRoot,
      defaultCwd: "/work/actions",
      terminal: { isTTY: true },
      confirmShare: async () => true,
      gistUpload: async (_payload, filename) => {
        filenames.push(filename);
        return { gistId: "registeredid" };
      },
      runSessionBrowser: async (input) => {
        launched = true;
        const row = input.rows[0];
        expect(row?.content_hash).toBe(contentHash);
        const shared = await input.onShare?.(row!);
        expect(shared?.url).toBe("https://agent-trail.dev/view/gist/registeredid");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(launched).toBe(true);
  expect(filenames[0]).toBe(`trail-${contentHash.slice(0, 12)}.trail.jsonl.gz.b64`);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runListBrowser share action re-registers stale source-backed rows", async () => {
  const { filePath, contentHash: staleHash } = await seedTrail({
    cwd: "/work/actions",
    firstText: "old source content",
  });
  await registerTrail(filePath, { storeRoot, sourcePath: filePath });
  await overrideRegisteredAt(storeRoot, { [staleHash]: "2026-05-17T14:00:00.000Z" });
  const refs: SessionRef[] = [
    {
      id: "sess-stale-source",
      adapter: "codex",
      cwd: "/work/actions",
      modifiedAt: "2026-05-18T14:00:00.000Z",
      path: filePath,
    },
  ];
  let sharedFilename: string | null = null;

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [parseableAdapter("codex", refs)],
      storeRoot,
      defaultCwd: "/work/actions",
      terminal: { isTTY: true },
      confirmShare: async () => true,
      gistUpload: async (_payload, filename) => {
        sharedFilename = filename;
        return { gistId: "freshid" };
      },
      runSessionBrowser: async (input) => {
        const row = input.rows[0];
        expect(row?.state).toBe("source+registered");
        expect(row?.content_hash).toBe(staleHash);
        const shared = await input.onShare?.(row!);
        expect(shared?.url).toBe("https://agent-trail.dev/view/gist/freshid");
        expect(shared?.rows?.[0]?.content_hash).not.toBe(staleHash);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(sharedFilename).not.toBe(`trail-${staleHash.slice(0, 12)}.trail.jsonl.gz.b64`);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runListBrowser share action re-registers source-backed rows with malformed source timestamp", async () => {
  const { filePath, contentHash: staleHash } = await seedTrail({
    cwd: "/work/actions",
    firstText: "old malformed timestamp content",
  });
  await registerTrail(filePath, { storeRoot, sourcePath: filePath });
  await overrideRegisteredAt(storeRoot, { [staleHash]: "2026-05-17T14:00:00.000Z" });
  const refs: SessionRef[] = [
    {
      id: "sess-malformed-source-time",
      adapter: "codex",
      cwd: "/work/actions",
      modifiedAt: "not-a-date",
      path: filePath,
    },
  ];
  let sharedFilename: string | null = null;

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [parseableAdapter("codex", refs)],
      storeRoot,
      defaultCwd: "/work/actions",
      terminal: { isTTY: true },
      confirmShare: async () => true,
      gistUpload: async (_payload, filename) => {
        sharedFilename = filename;
        return { gistId: "malformedtimeid" };
      },
      runSessionBrowser: async (input) => {
        const row = input.rows[0];
        expect(row?.state).toBe("source+registered");
        expect(row?.content_hash).toBe(staleHash);
        const shared = await input.onShare?.(row!);
        expect(shared?.url).toBe("https://agent-trail.dev/view/gist/malformedtimeid");
        expect(shared?.rows?.[0]?.content_hash).not.toBe(staleHash);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(sharedFilename).not.toBe(`trail-${staleHash.slice(0, 12)}.trail.jsonl.gz.b64`);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runListBrowser share action re-registers source-backed rows with missing source timestamp", async () => {
  const { filePath, contentHash: staleHash } = await seedTrail({
    cwd: "/work/actions",
    firstText: "old missing timestamp content",
  });
  await registerTrail(filePath, { storeRoot, sourcePath: filePath });
  await overrideRegisteredAt(storeRoot, { [staleHash]: "2026-05-17T14:00:00.000Z" });
  const refs: SessionRef[] = [
    {
      id: "sess-missing-source-time",
      adapter: "codex",
      cwd: "/work/actions",
      path: filePath,
    },
  ];
  let sharedFilename: string | null = null;

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [parseableAdapter("codex", refs)],
      storeRoot,
      defaultCwd: "/work/actions",
      terminal: { isTTY: true },
      confirmShare: async () => true,
      gistUpload: async (_payload, filename) => {
        sharedFilename = filename;
        return { gistId: "missingsourcetimeid" };
      },
      runSessionBrowser: async (input) => {
        const row = input.rows[0];
        expect(row?.state).toBe("source+registered");
        expect(row?.content_hash).toBe(staleHash);
        const shared = await input.onShare?.(row!);
        expect(shared?.url).toBe("https://agent-trail.dev/view/gist/missingsourcetimeid");
        expect(shared?.rows?.[0]?.content_hash).not.toBe(staleHash);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(sharedFilename).not.toBe(`trail-${staleHash.slice(0, 12)}.trail.jsonl.gz.b64`);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("parseShareJson rejects malformed successful share output", () => {
  expect(() => parseShareJson("not json")).toThrow("share returned invalid JSON");
  expect(() => parseShareJson("[]")).toThrow("share returned invalid JSON");
});

test("runListBrowser export action writes canonical bytes with existing export path", async () => {
  const { filePath, contentHash } = await seedTrail({ cwd: "/work/actions" });
  await registerTrail(filePath, { storeRoot });
  const exportDir = mkdtempSync(join(tmpdir(), "trail-cli-list-export-"));
  let launched = false;
  try {
    const result = await runListBrowser(
      {},
      {
        config: resolvedConfig(null),
        adapters: [],
        storeRoot,
        defaultCwd: "/work/actions",
        exportDir,
        terminal: { isTTY: true },
        runSessionBrowser: async (input) => {
          launched = true;
          const exported = await input.onExport?.(input.rows[0]!);
          expect(exported?.message).toContain(contentHash.slice(0, 12));
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    );

    const out = join(exportDir, `${contentHash.slice(0, 12)}.trail.jsonl`);
    expect(await readFile(out, "utf8")).toBe(await readFile(filePath, "utf8"));
    expect(launched).toBe(true);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  } finally {
    rmSync(exportDir, { recursive: true, force: true });
  }
});

test("runListBrowser copy action writes OSC52 when stdout exists", async () => {
  const { filePath } = await seedTrail({ cwd: "/work/actions" });
  await registerTrail(filePath, { storeRoot });
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  const chunks: string[] = [];
  (stdout as unknown as PassThrough).on("data", (chunk) => chunks.push(String(chunk)));

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [],
      storeRoot,
      defaultCwd: "/work/actions",
      terminal: { isTTY: true, stdout },
      runSessionBrowser: async (input) => {
        const copied = await input.onCopyUrl?.("https://agent-trail.dev/view/gist/copyid");
        expect(copied?.message).toBe("Copied URL");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(chunks.join("")).toContain("\u001b]52;c;");
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runListBrowser cwd scope keeps registered trail rows broad", async () => {
  const registered = await seedTrail({
    id: "01HSESS00000000000000BR0AD",
    cwd: "/work/registered-other",
    name: "Registered outside cwd",
  });
  const reg = await registerTrail(registered.filePath, { storeRoot });
  expect(reg.status).toBe("finalized");

  let launched = false;
  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [
        stubAdapter("codex", [
          {
            id: "sess-current-cwd",
            adapter: "codex",
            cwd: "/work/current",
            modifiedAt: "2026-05-18T14:00:00.000Z",
          },
          {
            id: "sess-other-cwd",
            adapter: "codex",
            cwd: "/work/other",
            modifiedAt: "2026-05-19T14:00:00.000Z",
          },
        ]),
      ],
      storeRoot,
      defaultCwd: "/work/current",
      terminal: { isTTY: true },
      runSessionBrowser: async ({ rows, scope }) => {
        launched = true;
        expect(scope).toEqual({ mode: "cwd", label: "current" });
        expect(rows).toContainEqual(expect.objectContaining({ source_id: "sess-current-cwd" }));
        expect(rows).not.toContainEqual(expect.objectContaining({ source_id: "sess-other-cwd" }));
        expect(rows).toContainEqual(
          expect.objectContaining({ content_hash: registered.contentHash }),
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(launched).toBe(true);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runListBrowser infers registered row agent without reading registered source path title", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "trail-cli-list-source-home-"));
  const sourceDir = join(tempRoot, ".codex");
  const sourcePath = join(sourceDir, "sessions", "2026", "06", "source.jsonl");
  const contentHash = "b".repeat(64);
  const storedPath = objectPath(storeRoot, contentHash);
  mkdirSync(dirname(sourcePath), { recursive: true });
  mkdirSync(dirname(storedPath), { recursive: true });
  mkdirSync(join(storeRoot, "index"), { recursive: true });
  await writeFile(
    sourcePath,
    `${JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "prompt from original codex source" },
    })}\n`,
    "utf8",
  );
  await writeFile(
    storedPath,
    `${JSON.stringify({
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000FBA",
      ts: "2026-05-17T14:00:00.000Z",
      cwd: "/work/from-trail",
    })}\n`,
    "utf8",
  );
  await writeFile(
    join(storeRoot, "index", "objects.json"),
    `${JSON.stringify({
      version: 1,
      entries: {
        [contentHash]: {
          registered_at: "2026-05-17T14:00:00.000Z",
          source_path: sourcePath,
          kind: "trail",
        },
      },
    })}\n`,
    "utf8",
  );

  let launched = false;
  try {
    const result = await runListBrowser(
      {},
      {
        config: resolvedConfig(null),
        adapters: [],
        storeRoot,
        defaultCwd: "/work/from-trail",
        terminal: { isTTY: true },
        runSessionBrowser: async ({ rows }) => {
          launched = true;
          expect(rows).toHaveLength(1);
          expect(rows[0]?.agent).toBe("codex");
          expect(rows[0]?.cwd).toBe("/work/from-trail");
          expect(rows[0]?.display_name).toBeNull();
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(launched).toBe(true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("runListBrowser can reload TUI rows between cwd and all scopes", async () => {
  const sourceDir = mkdtempSync(join(tmpdir(), "trail-cli-list-toggle-"));
  const alphaPath = join(sourceDir, "alpha.jsonl");
  const betaPath = join(sourceDir, "beta.jsonl");
  await writeFile(
    alphaPath,
    `${JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "alpha prompt" },
    })}\n`,
    "utf8",
  );
  await writeFile(
    betaPath,
    `${JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: "beta prompt" },
    })}\n`,
    "utf8",
  );

  try {
    const result = await runListBrowser(
      {},
      {
        config: resolvedConfig(null),
        adapters: [
          stubAdapter("codex", [
            {
              id: "sess-alpha",
              adapter: "codex",
              cwd: "/work/alpha",
              modifiedAt: "2026-05-17T14:00:00.000Z",
              path: alphaPath,
            },
            {
              id: "sess-beta",
              adapter: "codex",
              cwd: "/work/beta",
              modifiedAt: "2026-05-17T15:00:00.000Z",
              path: betaPath,
            },
          ]),
        ],
        storeRoot,
        defaultCwd: "/work/alpha",
        terminal: { isTTY: true },
        runSessionBrowser: async (input) => {
          expect(input.scope).toEqual({ mode: "cwd", label: "alpha" });
          expect(input.rows.map((row) => row.source_id)).toEqual(["sess-alpha"]);
          const allInput = await input.onToggleScope?.("all");
          expect(allInput?.scope).toEqual({ mode: "all", label: "all" });
          expect(allInput?.rows.map((row) => row.source_id)).toEqual(["sess-beta", "sess-alpha"]);
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
    );

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  } finally {
    rmSync(sourceDir, { recursive: true, force: true });
  }
});

test("runListBrowser all scope asks adapters for all cwd roots", async () => {
  const detectCalls: DetectOptions[] = [];
  const adapter: TrailAdapter = {
    name: "codex",
    async detectSessions(options = {}) {
      detectCalls.push(options);
      if (options.allCwds === true) {
        return [
          {
            id: "sess-alpha",
            adapter: "codex",
            cwd: "/work/alpha",
            modifiedAt: "2026-05-17T14:00:00.000Z",
          },
          {
            id: "sess-beta",
            adapter: "codex",
            cwd: "/work/beta",
            modifiedAt: "2026-05-17T15:00:00.000Z",
          },
        ];
      }
      return [
        {
          id: "sess-alpha",
          adapter: "codex",
          cwd: "/work/alpha",
          modifiedAt: "2026-05-17T14:00:00.000Z",
        },
      ];
    },
    async parseSession(): Promise<TrailFile> {
      throw new Error("not needed");
    },
    async isAvailable() {
      return true;
    },
    async sourceVersion() {
      return null;
    },
    async sourceHealth() {
      return {
        adapter: "codex",
        path: null,
        present: true,
        readable: true,
        sessionCount: 2,
        sourceVersion: null,
        warnings: [],
      };
    },
  };

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [adapter],
      storeRoot,
      defaultCwd: "/work/alpha",
      terminal: { isTTY: true },
      runSessionBrowser: async (input) => {
        expect(input.rows.map((row) => row.source_id)).toEqual(["sess-alpha"]);
        const allInput = await input.onToggleScope?.("all");
        expect(allInput?.rows.map((row) => row.source_id)).toEqual(["sess-beta", "sess-alpha"]);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
  );

  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  expect(detectCalls).toEqual([{ cwd: "/work/alpha" }, { allCwds: true }]);
});

test("runListBrowser uses default OpenTUI handoff with custom streams", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdout.resume();
  setTimeout(() => stdin.write("q"), 100);

  const result = await runListBrowser(
    {},
    {
      config: resolvedConfig(null),
      adapters: [],
      storeRoot,
      terminal: {
        isTTY: true,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        width: 80,
        height: 24,
      },
    },
  );

  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
});

test("runCli list keeps plain output in non-TTY", async () => {
  const result = await runCli(["list"], {
    config: resolvedConfig(null),
    adapters: [
      stubAdapter("codex", [
        {
          id: "sess-plain",
          adapter: "codex",
          cwd: process.cwd(),
          modifiedAt: "2026-05-17T14:00:00.000Z",
        },
      ]),
    ],
    storeRoot,
    terminal: { isTTY: false },
    runSessionBrowser: async () => {
      throw new Error("should not launch TUI");
    },
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("sess-plain");
});

test("runCli list --json and --plain bypass TUI in TTY", async () => {
  const context = {
    config: resolvedConfig(null),
    adapters: [
      stubAdapter("codex", [
        {
          id: "sess-json",
          adapter: "codex",
          cwd: process.cwd(),
          modifiedAt: "2026-05-17T14:00:00.000Z",
        },
      ]),
    ],
    storeRoot,
    terminal: { isTTY: true },
    runSessionBrowser: async () => {
      throw new Error("should not launch TUI");
    },
  };

  const json = await runCli(["list", "--json"], context);
  expect(JSON.parse(json.stdout)).toEqual([expect.objectContaining({ source_id: "sess-json" })]);

  const plain = await runCli(["list", "--plain"], context);
  expect(plain.stdout).toContain("sess-json");
});

test("runCli with no args opens TUI in TTY", async () => {
  let launched = false;
  const result = await runCli([], {
    config: resolvedConfig(null),
    adapters: [],
    storeRoot,
    terminal: { isTTY: true },
    runSessionBrowser: async ({ rows }) => {
      launched = true;
      expect(rows).toEqual([]);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  expect(launched).toBe(true);
  expect(result.exitCode).toBe(0);
});

test("runCli with no args keeps help in non-TTY", async () => {
  const result = await runCli([], {
    terminal: { isTTY: false },
    runSessionBrowser: async () => {
      throw new Error("should not launch TUI");
    },
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Agent Trail command-line interface.");
});

test("runCli list loads default source filter from config files", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "trail-cli-list-config-"));
  try {
    mkdirSync(join(projectRoot, ".agent-trail"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".agent-trail", "config.json"),
      JSON.stringify({ sources: { defaultFilter: "pi" } }),
    );
    const codex = await seedTrail({
      id: "01HSESS0000000000000000AAA",
      agentName: "codex-cli",
      cwd: "/work/a",
    });
    const pi = await seedTrail({
      id: "01HSESS0000000000000000ABB",
      agentName: "pi",
      cwd: "/work/b",
    });
    await registerTrail(codex.filePath, { storeRoot });
    await registerTrail(pi.filePath, { storeRoot });

    const result = await runCli(["list", "--json"], {
      env: { HOME: projectRoot },
      adapters: [],
      projectRoot,
      storeRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; agent: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.content_hash).toBe(pi.contentHash);
    expect(parsed[0]?.agent).toBe("pi");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("--agent overrides resolved config default source filter through runCli list", async () => {
  const codex = await seedTrail({
    id: "01HSESS0000000000000000AAA",
    agentName: "codex-cli",
    cwd: "/work/a",
  });
  const pi = await seedTrail({
    id: "01HSESS0000000000000000ABB",
    agentName: "pi",
    cwd: "/work/b",
  });
  await registerTrail(codex.filePath, { storeRoot });
  await registerTrail(pi.filePath, { storeRoot });

  const result = await runCli(["list", "--json", "--agent", "codex-cli"], {
    config: resolvedConfig("pi"),
    adapters: [],
    storeRoot,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; agent: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(codex.contentHash);
  expect(parsed[0]?.agent).toBe("codex-cli");
});

test("--cwd filters by exact cwd", async () => {
  const a = await seedTrail({ id: "01HSESS0000000000000000AAA", cwd: "/work/proj-a" });
  const b = await seedTrail({ id: "01HSESS0000000000000000ABB", cwd: "/work/proj-b" });
  await registerTrail(a.filePath, { storeRoot });
  await registerTrail(b.filePath, { storeRoot });

  const result = await runList({ json: true, cwd: "/work/proj-b" }, { storeRoot, adapters: [] });

  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; cwd: string }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(b.contentHash);
  expect(parsed[0]?.cwd).toBe("/work/proj-b");
});

test("--since / --until: inclusive lower, exclusive upper bound on registered_at", async () => {
  const t1 = await seedTrail({ id: "01HSESS000000000000000001A", cwd: "/work/1" });
  const t2 = await seedTrail({ id: "01HSESS000000000000000002A", cwd: "/work/2" });
  const t3 = await seedTrail({ id: "01HSESS000000000000000003A", cwd: "/work/3" });
  await registerTrail(t1.filePath, { storeRoot });
  await registerTrail(t2.filePath, { storeRoot });
  await registerTrail(t3.filePath, { storeRoot });
  await overrideRegisteredAt(storeRoot, {
    [t1.contentHash]: "2026-01-01T00:00:00.000Z",
    [t2.contentHash]: "2026-02-01T00:00:00.000Z",
    [t3.contentHash]: "2026-03-01T00:00:00.000Z",
  });

  const result = await runList(
    {
      json: true,
      since: "2026-02-01T00:00:00.000Z",
      until: "2026-03-01T00:00:00.000Z",
    },
    { storeRoot, adapters: [] },
  );

  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string }>;
  expect(parsed.map((r) => r.content_hash)).toEqual([t2.contentHash]);
});

test("missing object file: warns to stderr, still lists remaining, exit 0", async () => {
  const present = await seedTrail({ id: "01HSESS00000000000000000K0", cwd: "/work/ok" });
  const removed = await seedTrail({ id: "01HSESS00000000000000000RM", cwd: "/work/rm" });
  await registerTrail(present.filePath, { storeRoot });
  const removedReg = await registerTrail(removed.filePath, { storeRoot });
  await unlink(removedReg.objectPath as string);

  const result = await runList({ json: true }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain(removed.contentHash);
  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string; agent: string | null }>;
  const hashes = parsed.map((r) => r.content_hash).sort();
  expect(hashes).toEqual([present.contentHash, removed.contentHash].sort());
  const removedRow = parsed.find((r) => r.content_hash === removed.contentHash);
  expect(removedRow?.agent).toBeNull();
});

test("unknown flag exits 1 with usage on stderr", async () => {
  const result = await runCli(["list", "--nope"]);

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("--nope");
  expect(result.stderr).toContain("Usage: trail list");
});

test("invalid --since exits 1 with stderr message", async () => {
  const result = await runList({ since: "not-a-date" }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("invalid --since");
});

test("invalid --source exits 1 with stderr message", async () => {
  const result = await runList({ source: "weird" }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain('--source must be "all", "source", or "registered"');
});

test("invalid --limit exits 1 with stderr message", async () => {
  const result = await runList({ limit: "nope" }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("invalid --limit");
});

test("invalid --since and --until both reported", async () => {
  const result = await runList({ since: "bad1", until: "bad2" }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("invalid --since value: bad1");
  expect(result.stderr).toContain("invalid --until value: bad2");
});

test("corrupt index: exits 1 with friendly stderr (no stack trace)", async () => {
  mkdirSync(join(storeRoot, "index"), { recursive: true });
  await writeFile(join(storeRoot, "index", "objects.json"), "{not json", "utf8");

  const result = await runList({}, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("malformed JSON");
  expect(result.stderr).not.toMatch(/\.ts:\d+/);
});

test("malformed index entry (null value): skipped with warning, exit 0", async () => {
  const good = await seedTrail({ id: "01HSESS00000000000000000K0", cwd: "/work/ok" });
  await registerTrail(good.filePath, { storeRoot });
  const indexPath = join(storeRoot, "index", "objects.json");
  const raw = await readFile(indexPath, "utf8");
  const idx = JSON.parse(raw) as { version: number; entries: Record<string, unknown> };
  const badHash = "0".repeat(64);
  idx.entries[badHash] = null;
  await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");

  const result = await runList({ json: true }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain(badHash);
  expect(result.stderr).toContain("malformed index entry");
  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string }>;
  expect(parsed.map((r) => r.content_hash)).toEqual([good.contentHash]);
});

test("malformed index key (path traversal): skipped with warning, exit 0", async () => {
  const good = await seedTrail({ id: "01HSESS00000000000000000K0", cwd: "/work/ok" });
  await registerTrail(good.filePath, { storeRoot });
  const indexPath = join(storeRoot, "index", "objects.json");
  const raw = await readFile(indexPath, "utf8");
  const idx = JSON.parse(raw) as {
    version: number;
    entries: Record<string, { registered_at: string; source_path: string | null }>;
  };
  const evilKey = "../../../etc/passwd";
  idx.entries[evilKey] = { registered_at: "2026-01-01T00:00:00.000Z", source_path: null };
  await writeFile(indexPath, `${JSON.stringify(idx, null, 2)}\n`, "utf8");

  const result = await runList({ json: true }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain("malformed index key");
  expect(result.stderr).toContain(evilKey);
  const parsed = JSON.parse(result.stdout) as Array<{ content_hash: string }>;
  expect(parsed.map((r) => r.content_hash)).toEqual([good.contentHash]);
});

test("resolveStoreRoot failure (no HOME, no AGENT_TRAIL_HOME): exit 1 friendly stderr", async () => {
  const savedHome = process.env.HOME;
  const savedTrailHome = process.env.AGENT_TRAIL_HOME;
  process.env.HOME = "";
  process.env.AGENT_TRAIL_HOME = "";
  try {
    const result = await runList(undefined, { adapters: [] });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("store root");
    expect(result.stderr).not.toMatch(/\.ts:\d+/);
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedTrailHome === undefined) delete process.env.AGENT_TRAIL_HOME;
    else process.env.AGENT_TRAIL_HOME = savedTrailHome;
  }
});

test("runListBrowser resolveStoreRoot failure returns friendly stderr", async () => {
  const savedHome = process.env.HOME;
  const savedTrailHome = process.env.AGENT_TRAIL_HOME;
  process.env.HOME = "";
  process.env.AGENT_TRAIL_HOME = "";
  try {
    const result = await runListBrowser(undefined, {
      adapters: [],
      terminal: { isTTY: true },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("store root");
    expect(result.stderr).not.toMatch(/\.ts:\d+/);
  } finally {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedTrailHome === undefined) delete process.env.AGENT_TRAIL_HOME;
    else process.env.AGENT_TRAIL_HOME = savedTrailHome;
  }
});

test("non-JSON header line: row included with null agent/cwd, warning on stderr", async () => {
  const { filePath, contentHash } = await seedTrail({
    id: "01HSESS00000000000000BAD00",
    cwd: "/work/bad",
  });
  const reg = await registerTrail(filePath, { storeRoot });
  expect(reg.status).toBe("finalized");
  await writeFile(reg.objectPath as string, "not a json object\n", "utf8");

  const result = await runList({ json: true }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toContain(contentHash);
  const parsed = JSON.parse(result.stdout) as Array<{
    content_hash: string;
    agent: string | null;
    cwd: string | null;
  }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(contentHash);
  expect(parsed[0]?.agent).toBeNull();
  expect(parsed[0]?.cwd).toBeNull();
});

test("malformed header lines are skipped before a later valid session header", async () => {
  const { filePath, contentHash } = await seedTrail({
    cwd: "/work/recovered",
  });
  const reg = await registerTrail(filePath, { storeRoot });
  expect(reg.status).toBe("finalized");
  await writeFile(
    reg.objectPath as string,
    `not json\n${JSON.stringify(["not-object"])}\n${JSON.stringify({
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
      cwd: "/work/recovered",
      content_hash: contentHash,
    })}\n`,
    "utf8",
  );

  const result = await runList({ json: true }, { storeRoot, adapters: [] });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const parsed = JSON.parse(result.stdout) as Array<{
    content_hash: string;
    agent: string | null;
    cwd: string | null;
  }>;
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.content_hash).toBe(contentHash);
  expect(parsed[0]?.agent).toBe("codex-cli");
  expect(parsed[0]?.cwd).toBe("/work/recovered");
});

test("multi-session file -> 2 session rows + 1 trail row in registered rows", async () => {
  const { stampTrail, canonicalizeRecords: canon } = await import("@agent-trail/core");

  const records = [
    {
      line: 1,
      raw: "",
      value: {
        type: "trail",
        schema_version: "0.1.0",
        id: "01HTRA0X00000000000000A001",
        ts: "2026-05-17T14:00:00.000Z",
        producer: "trail-cli/0.3.0",
      },
    },
    {
      line: 2,
      raw: "",
      value: {
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000A01",
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex-cli" },
      },
    },
    {
      line: 3,
      raw: "",
      value: {
        type: "user_message",
        id: "01HEVTA0000000000000000A01",
        ts: "2026-05-17T14:00:05.000Z",
        payload: { text: "hi" },
      },
    },
    {
      line: 4,
      raw: "",
      value: {
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000A02",
        ts: "2026-05-17T14:05:00.000Z",
        agent: { name: "claude-code" },
      },
    },
    {
      line: 5,
      raw: "",
      value: {
        type: "user_message",
        id: "01HEVTA0000000000000000A02",
        ts: "2026-05-17T14:05:05.000Z",
        payload: { text: "ok" },
      },
    },
  ];
  const stamped = stampTrail(records);
  const bytes = canon(records);

  const dir = mkdtempSync(join(tmpdir(), "trail-cli-list-msfix-"));
  const filePath = join(dir, "multi.trail.jsonl");
  await writeFile(filePath, bytes, "utf8");
  await registerTrail(filePath, { storeRoot });

  const all = await runList({ json: true }, { storeRoot, adapters: [] });
  expect(all.exitCode).toBe(0);
  const allRows = JSON.parse(all.stdout) as Array<{
    content_hash: string;
    registered_kind: string;
    agent: string | null;
  }>;
  expect(allRows).toHaveLength(3);
  expect(
    allRows
      .filter((r) => r.registered_kind === "session")
      .map((r) => r.content_hash)
      .sort(),
  ).toEqual([...stamped.sessionHashes].sort());
  expect(allRows.find((r) => r.registered_kind === "trail")?.content_hash).toBe(
    stamped.envelopeHash as string,
  );
  expect(allRows.find((r) => r.registered_kind === "trail")?.agent).toBe("codex-cli");

  rmSync(dir, { recursive: true, force: true });
});

test("source-backed multi-session rows keep session rows and back the source row with the file-level trail hash", async () => {
  const { stampTrail, canonicalizeRecords: canon } = await import("@agent-trail/core");

  const records = [
    {
      line: 1,
      raw: "",
      value: {
        type: "trail",
        schema_version: "0.1.0",
        id: "01HTRA0X00000000000000B001",
        ts: "2026-05-17T14:00:00.000Z",
        producer: "trail-cli/0.3.0",
      },
    },
    {
      line: 2,
      raw: "",
      value: {
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000B01",
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "codex-cli" },
      },
    },
    {
      line: 3,
      raw: "",
      value: {
        type: "user_message",
        id: "01HEVTB0000000000000000B01",
        ts: "2026-05-17T14:00:05.000Z",
        payload: { text: "hi" },
      },
    },
    {
      line: 4,
      raw: "",
      value: {
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESS0000000000000000B02",
        ts: "2026-05-17T14:05:00.000Z",
        agent: { name: "claude-code" },
      },
    },
    {
      line: 5,
      raw: "",
      value: {
        type: "user_message",
        id: "01HEVTB0000000000000000B02",
        ts: "2026-05-17T14:05:05.000Z",
        payload: { text: "ok" },
      },
    },
  ];
  const stamped = stampTrail(records);
  const dir = mkdtempSync(join(tmpdir(), "trail-cli-list-ms-source-"));
  const filePath = join(dir, "multi.trail.jsonl");
  await writeFile(filePath, canon(records), "utf8");
  await registerTrail(filePath, { storeRoot, sourcePath: filePath });

  const result = await runList(
    { json: true },
    {
      storeRoot,
      adapters: [
        stubAdapter("codex", [
          {
            id: "source-backed-multi",
            adapter: "codex",
            modifiedAt: "2026-05-18T14:00:00.000Z",
            path: filePath,
          },
        ]),
      ],
    },
  );

  const rows = JSON.parse(result.stdout) as Array<{
    state: string;
    content_hash: string;
    registered_kind: string;
  }>;
  expect(rows).toHaveLength(3);
  expect(rows).toContainEqual(
    expect.objectContaining({
      state: "source+registered",
      content_hash: stamped.envelopeHash,
      registered_kind: "trail",
    }),
  );
  expect(rows).toContainEqual(
    expect.objectContaining({
      state: "registered",
      content_hash: stamped.sessionHashes[0],
      registered_kind: "session",
    }),
  );
  expect(rows).toContainEqual(
    expect.objectContaining({
      state: "registered",
      content_hash: stamped.sessionHashes[1],
      registered_kind: "session",
    }),
  );

  rmSync(dir, { recursive: true, force: true });
});
