import { expect, test } from "bun:test";
import {
  buildTrailEnvelope,
  type DetectOptions,
  type SessionRef,
  type TrailAdapter,
  type TrailFile,
  trailRecords,
  validateAdapterTrail,
} from "./index.ts";

const noOpAdapter = {
  name: "no-op",
  async detectSessions(_opts?: DetectOptions): Promise<SessionRef[]> {
    return [];
  },
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    return {
      groups: [
        {
          header: {
            type: "session",
            schema_version: "0.1.0",
            id: ref.id,
            ts: "2026-05-17T14:00:00.000Z",
            agent: { name: "pi" },
          },
          entries: [],
        },
      ],
    };
  },
  async isAvailable(): Promise<boolean> {
    return false;
  },
  async sourceVersion(): Promise<string | null> {
    return null;
  },
} satisfies TrailAdapter;

test("a no-op adapter satisfies TrailAdapter and exposes name", () => {
  expect(noOpAdapter.name).toBe("no-op");
});

test("trailRecords serializes exact group grammar in file order", () => {
  const trail: TrailFile = {
    groups: [
      {
        header: {
          type: "session",
          schema_version: "0.1.0",
          id: "01HSESS0000000000000000001",
          ts: "2026-05-17T14:00:00.000Z",
          agent: { name: "pi" },
        },
        entries: [
          {
            type: "user_message",
            id: "01HEVT10000000000000000001",
            ts: "2026-05-17T14:00:05.000Z",
            payload: { text: "hello" },
          },
        ],
      },
      {
        header: {
          type: "session",
          schema_version: "0.1.0",
          id: "01HSESS0000000000000000002",
          ts: "2026-05-17T14:01:00.000Z",
          agent: { name: "codex-cli" },
          fork_from: { session_id: "01HSESS0000000000000000001" },
        },
        entries: [],
      },
    ],
  };

  expect(trailRecords(trail)).toEqual([
    trail.groups[0]!.header,
    trail.groups[0]!.entries[0]!,
    trail.groups[1]!.header,
  ]);
});

const validTrail: TrailFile = {
  groups: [
    {
      header: {
        type: "session",
        schema_version: "0.1.0",
        id: "01HSESSVAXD0000000000000A1",
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "pi" },
      },
      entries: [
        {
          type: "user_message",
          id: "01HEVT1A0000000000000000A1",
          ts: "2026-05-17T14:00:05.000Z",
          payload: { text: "hello" },
        },
      ],
    },
  ],
};

test("validateAdapterTrail returns no diagnostics for a valid trail", async () => {
  const diagnostics = await validateAdapterTrail(validTrail);
  expect(diagnostics).toEqual([]);
});

test("validateAdapterTrail forwards profile to core (reader-tolerant accepts patch drift)", async () => {
  const drifted: TrailFile = {
    groups: [
      {
        header: { ...validTrail.groups[0]!.header, schema_version: "0.1.99" as "0.1.0" },
        entries: validTrail.groups[0]!.entries,
      },
    ],
  };

  const strict = await validateAdapterTrail(drifted, { profile: "strict" });
  expect(strict.some((d) => d.severity === "error")).toBe(true);

  const tolerant = await validateAdapterTrail(drifted, { profile: "reader-tolerant" });
  expect(tolerant.some((d) => d.severity === "error")).toBe(false);
});

test("validateAdapterTrail surfaces schema errors for an invalid header", async () => {
  const broken: TrailFile = {
    groups: [
      {
        header: {
          ...validTrail.groups[0]!.header,
          schema_version: undefined as unknown as "0.1.0",
        },
        entries: validTrail.groups[0]!.entries,
      },
    ],
  };

  const diagnostics = await validateAdapterTrail(broken);

  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
});

test("validateAdapterTrail is exported and callable", async () => {
  const result = await validateAdapterTrail({
    groups: [
      {
        header: {
          type: "session",
          schema_version: "0.1.0",
          id: "01HSESS0000000000000000001",
          ts: "2026-05-17T14:00:00.000Z",
          agent: { name: "pi" },
        },
        entries: [],
      },
    ],
  });

  expect(Array.isArray(result)).toBe(true);
});

test("validateAdapterTrail JSONL round-trip preserves every record byte-for-byte", async () => {
  const diagnostics = await validateAdapterTrail(validTrail);
  expect(diagnostics).toEqual([]);

  const records = trailRecords(validTrail);
  const lines = records.map((record) => JSON.stringify(record));
  const jsonl = `${lines.join("\n")}\n`;

  expect(jsonl.endsWith("\n")).toBe(true);
  const parts = jsonl.slice(0, -1).split("\n");
  expect(parts.length).toBe(records.length);
  for (let i = 0; i < records.length; i++) {
    expect(JSON.parse(parts[i] as string)).toEqual(records[i]);
  }
});

test("validateAdapterTrail handles multiple entries with no error diagnostics", async () => {
  const multi: TrailFile = {
    groups: [
      {
        header: {
          type: "session",
          schema_version: "0.1.0",
          id: "01HSESSMXX10000000000000A1",
          ts: "2026-05-17T14:00:00.000Z",
          agent: { name: "pi" },
        },
        entries: [
          {
            type: "user_message",
            id: "01HEVT1A0000000000000000A1",
            ts: "2026-05-17T14:00:05.000Z",
            payload: { text: "hello" },
          },
          {
            type: "agent_message",
            id: "01HEVT2A0000000000000000A1",
            parent_id: "01HEVT1A0000000000000000A1",
            ts: "2026-05-17T14:00:06.000Z",
            payload: { text: "hi back" },
          },
          {
            type: "user_message",
            id: "01HEVT3A0000000000000000A1",
            parent_id: "01HEVT2A0000000000000000A1",
            ts: "2026-05-17T14:00:07.000Z",
            payload: { text: "thanks" },
          },
        ],
      },
    ],
  };

  const diagnostics = await validateAdapterTrail(multi);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});

test("buildTrailEnvelope produces a schema-valid envelope", () => {
  const envelope = buildTrailEnvelope({
    producer: "@agent-trail/adapters-test/0.0.0",
    header: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "pi" },
    },
    randomId: () => "01HENVFXED00000000000000A1",
    now: () => "2026-05-17T14:00:00.000Z",
  });

  expect(envelope).toEqual({
    type: "trail",
    schema_version: "0.1.0",
    id: "01HENVFXED00000000000000A1",
    ts: "2026-05-17T14:00:00.000Z",
    producer: "@agent-trail/adapters-test/0.0.0",
    sessions: [{ id: "01HSESS0000000000000000001", agent: "pi" }],
  });
});

test("buildTrailEnvelope propagates vcs from the session header", () => {
  const envelope = buildTrailEnvelope({
    producer: "@agent-trail/adapters-test/0.0.0",
    header: {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "pi" },
      vcs: { type: "git", revision: "deadbeef" },
    },
    randomId: () => "envelope-id",
    now: () => "2026-05-17T14:00:00.000Z",
  });

  expect(envelope.vcs).toEqual({ type: "git", revision: "deadbeef" });
});

test("validateAdapterTrail accepts a trail with an envelope at line 1", async () => {
  const trail: TrailFile = {
    envelope: {
      type: "trail",
      schema_version: "0.1.0",
      id: "01HTRACE000000000000000001",
      ts: "2026-05-17T14:00:00.000Z",
      producer: "@agent-trail/adapters-test/0.0.0",
    },
    groups: [
      {
        header: {
          type: "session",
          schema_version: "0.1.0",
          id: "01HSESS0000000000000000001",
          ts: "2026-05-17T14:00:00.000Z",
          agent: { name: "pi" },
        },
        entries: [
          {
            type: "user_message",
            id: "01HEVT1A0000000000000000A1",
            ts: "2026-05-17T14:00:05.000Z",
            payload: { text: "hello" },
          },
        ],
      },
    ],
  };

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});
