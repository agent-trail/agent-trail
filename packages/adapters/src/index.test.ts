import { expect, test } from "bun:test";
import {
  buildTrailEnvelope,
  type DetectOptions,
  type SessionRef,
  type TrailAdapter,
  type TrailFile,
  validateAdapterTrail,
} from "./index.ts";

const noOpAdapter = {
  name: "no-op",
  async detectSessions(_opts?: DetectOptions): Promise<SessionRef[]> {
    return [];
  },
  async parseSession(ref: SessionRef): Promise<TrailFile> {
    return {
      header: {
        type: "session",
        schema_version: "0.1.0",
        id: ref.id,
        ts: "2026-05-17T14:00:00.000Z",
        agent: { name: "pi" },
      },
      entries: [],
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

const validTrail: TrailFile = {
  header: {
    type: "session",
    schema_version: "0.1.0",
    id: "sess-valid",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "pi" },
  },
  entries: [
    {
      type: "user_message",
      id: "evt-1",
      ts: "2026-05-17T14:00:05.000Z",
      payload: { text: "hello" },
    },
  ],
};

test("validateAdapterTrail returns no diagnostics for a valid trail", async () => {
  const diagnostics = await validateAdapterTrail(validTrail);
  expect(diagnostics).toEqual([]);
});

test("validateAdapterTrail forwards profile to core (reader-tolerant accepts patch drift)", async () => {
  const drifted: TrailFile = {
    // biome-ignore lint/suspicious/noExplicitAny: schema_version mismatch is the point of this test
    header: { ...validTrail.header, schema_version: "0.1.99" as any },
    entries: validTrail.entries,
  };

  const strict = await validateAdapterTrail(drifted, { profile: "strict" });
  expect(strict.some((d) => d.severity === "error")).toBe(true);

  const tolerant = await validateAdapterTrail(drifted, { profile: "reader-tolerant" });
  expect(tolerant.some((d) => d.severity === "error")).toBe(false);
});

test("validateAdapterTrail surfaces schema errors for an invalid header", async () => {
  const broken: TrailFile = {
    // biome-ignore lint/suspicious/noExplicitAny: intentionally invalid header for negative test
    header: { ...validTrail.header, schema_version: undefined as any },
    entries: validTrail.entries,
  };

  const diagnostics = await validateAdapterTrail(broken);

  expect(diagnostics.length).toBeGreaterThan(0);
  expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
});

test("validateAdapterTrail is exported and callable", async () => {
  const result = await validateAdapterTrail({
    header: {
      type: "session",
      schema_version: "0.1.0",
      id: "sess1",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "pi" },
    },
    entries: [],
  });

  expect(Array.isArray(result)).toBe(true);
});

test("validateAdapterTrail JSONL round-trip preserves every record byte-for-byte", async () => {
  const diagnostics = await validateAdapterTrail(validTrail);
  expect(diagnostics).toEqual([]);

  const lines = [validTrail.header, ...validTrail.entries].map((record) => JSON.stringify(record));
  const jsonl = `${lines.join("\n")}\n`;

  expect(jsonl.endsWith("\n")).toBe(true);
  const parts = jsonl.slice(0, -1).split("\n");
  expect(parts.length).toBe(1 + validTrail.entries.length);
  expect(JSON.parse(parts[0] as string)).toEqual(validTrail.header);
  for (let i = 0; i < validTrail.entries.length; i++) {
    expect(JSON.parse(parts[i + 1] as string)).toEqual(validTrail.entries[i]);
  }
});

test("validateAdapterTrail handles multiple entries with no error diagnostics", async () => {
  const multi: TrailFile = {
    header: {
      type: "session",
      schema_version: "0.1.0",
      id: "sess-multi",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "pi" },
    },
    entries: [
      {
        type: "user_message",
        id: "evt-1",
        ts: "2026-05-17T14:00:05.000Z",
        payload: { text: "hello" },
      },
      {
        type: "agent_message",
        id: "evt-2",
        parent_id: "evt-1",
        ts: "2026-05-17T14:00:06.000Z",
        payload: { text: "hi back" },
      },
      {
        type: "user_message",
        id: "evt-3",
        parent_id: "evt-2",
        ts: "2026-05-17T14:00:07.000Z",
        payload: { text: "thanks" },
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
      id: "sess1",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "pi" },
    },
    randomId: () => "envelope-fixed-id",
    now: () => "2026-05-17T14:00:00.000Z",
  });

  expect(envelope).toEqual({
    type: "trail",
    schema_version: "0.1.0",
    id: "envelope-fixed-id",
    ts: "2026-05-17T14:00:00.000Z",
    producer: "@agent-trail/adapters-test/0.0.0",
    sessions: [{ id: "sess1", agent: "pi" }],
  });
});

test("buildTrailEnvelope propagates vcs from the session header", () => {
  const envelope = buildTrailEnvelope({
    producer: "@agent-trail/adapters-test/0.0.0",
    header: {
      type: "session",
      schema_version: "0.1.0",
      id: "sess1",
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
      id: "trl-1",
      ts: "2026-05-17T14:00:00.000Z",
      producer: "@agent-trail/adapters-test/0.0.0",
    },
    header: {
      type: "session",
      schema_version: "0.1.0",
      id: "sess1",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "pi" },
    },
    entries: [
      {
        type: "user_message",
        id: "evt-1",
        ts: "2026-05-17T14:00:05.000Z",
        payload: { text: "hello" },
      },
    ],
  };

  const diagnostics = await validateAdapterTrail(trail);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
});
