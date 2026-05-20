import { expect, test } from "bun:test";
import {
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
