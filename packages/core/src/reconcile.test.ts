import { expect, test } from "bun:test";
import { canonicalizeRecords, computeContentHash } from "./hash.ts";
import { parseJsonlString } from "./jsonl.ts";
import { reconcileSegments, type SegmentInput } from "./reconcile.ts";

const SESSION_UID = "01HSESSUID1111111111111111";
const SESSION_UID_B = "01HSESSUID2222222222222222";

async function records(jsonl: string): Promise<SegmentInput["records"]> {
  return parseJsonlString(jsonl);
}

function trailHeader(opts: {
  id: string;
  ts: string;
  session_uid?: string;
  segment?: { seq: number; prev_content_hash?: string | null };
  cwd?: string;
  content_hash?: string;
}): string {
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: opts.id,
    ts: opts.ts,
    agent: { name: "codex-cli" },
  };
  if (opts.session_uid !== undefined) header.session_uid = opts.session_uid;
  if (opts.segment !== undefined) header.segment = opts.segment;
  if (opts.cwd !== undefined) header.cwd = opts.cwd;
  if (opts.content_hash !== undefined) header.content_hash = opts.content_hash;
  return JSON.stringify(header);
}

function userMessage(id: string, ts: string, text = "hello"): string {
  return JSON.stringify({ type: "user_message", id, ts, payload: { text } });
}

function agentMessage(id: string, ts: string, text = "hi"): string {
  return JSON.stringify({ type: "agent_message", id, ts, payload: { text } });
}

function sessionTerminated(id: string, ts: string, reason: string): string {
  return JSON.stringify({
    type: "session_terminated",
    id,
    ts,
    payload: { reason },
  });
}

async function hashOf(jsonl: string): Promise<string> {
  return computeContentHash(await parseJsonlString(jsonl));
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice A — reconcileSegments tracer-bullet tests
// ─────────────────────────────────────────────────────────────────────────────

test("single segment in → same records out, zero warnings", async () => {
  const trail = `${[
    trailHeader({ id: "01HSESS0000000000000000001", ts: "2026-05-26T10:00:00.000Z" }),
    userMessage("01HEVTA0000000000000000001", "2026-05-26T10:00:05.000Z"),
  ].join("\n")}\n`;
  const parsed = await records(trail);
  const result = reconcileSegments([{ source: "a.trail.jsonl", records: parsed }]);
  expect(result.warnings).toEqual([]);
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0]?.events_deduped).toBe(0);
  expect(result.groups[0]?.canonical).toBe(canonicalizeRecords(parsed));
});

test("two segments same session_uid, valid chain → merged, header ts from seg-1, events concatenated", async () => {
  const seg1Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000001",
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage("01HEVTA0000000000000000001", "2026-05-26T10:00:05.000Z"),
  ].join("\n")}\n`;
  const seg1Hash = await hashOf(seg1Text);

  const seg2Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000002",
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 2, prev_content_hash: seg1Hash },
      cwd: "/tmp/late-state",
    }),
    agentMessage("01HEVTA0000000000000000002", "2026-05-26T10:05:05.000Z"),
  ].join("\n")}\n`;

  const result = reconcileSegments([
    { source: "seg1", records: await records(seg1Text) },
    { source: "seg2", records: await records(seg2Text) },
  ]);
  expect(result.warnings).toEqual([]);
  expect(result.groups).toHaveLength(1);
  const group = result.groups[0];
  if (group === undefined) throw new Error("expected one group");

  expect(group.session_uid).toBe(SESSION_UID);
  expect(group.segments).toEqual(["seg1", "seg2"]);
  expect(group.events_deduped).toBe(0);
  expect(group.intermediate_terminators_dropped).toBe(0);

  // ts comes from seg-1 (real start), cwd from seg-2 (latest state).
  const header = group.records[0]?.value as Record<string, unknown>;
  expect(header.ts).toBe("2026-05-26T10:00:00.000Z");
  expect(header.cwd).toBe("/tmp/late-state");
  // segment.* is dropped from merged header.
  expect(header.segment).toBeUndefined();
  // Both events present in order.
  expect(group.records).toHaveLength(3);
  expect((group.records[1]?.value as { id: string }).id).toBe("01HEVTA0000000000000000001");
  expect((group.records[2]?.value as { id: string }).id).toBe("01HEVTA0000000000000000002");
});

test("dedup: event id present in both segments is emitted once", async () => {
  const seg1Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000001",
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage("01HEVTA0000000000000000001", "2026-05-26T10:00:05.000Z"),
    agentMessage("01HEVTA0000000000000000002", "2026-05-26T10:00:07.000Z"),
  ].join("\n")}\n`;
  const seg1Hash = await hashOf(seg1Text);

  const seg2Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000002",
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 2, prev_content_hash: seg1Hash },
    }),
    // Re-emitted overlap: same id as seg1's last event.
    agentMessage("01HEVTA0000000000000000002", "2026-05-26T10:00:07.000Z"),
    userMessage("01HEVTA0000000000000000003", "2026-05-26T10:05:05.000Z", "next"),
  ].join("\n")}\n`;

  const result = reconcileSegments([
    { source: "seg1", records: await records(seg1Text) },
    { source: "seg2", records: await records(seg2Text) },
  ]);
  expect(result.warnings).toEqual([]);
  const group = result.groups[0];
  expect(group?.events_deduped).toBe(1);
  // 1 header + 3 unique events
  expect(group?.records).toHaveLength(4);
});

test("prev_content_hash mismatch → warning, merge still proceeds", async () => {
  const seg1RealHash = await hashOf(
    `${[
      trailHeader({
        id: "01HSESS0000000000000000001",
        ts: "2026-05-26T10:00:00.000Z",
        session_uid: SESSION_UID,
        segment: { seq: 1 },
      }),
      userMessage("01HEVTA0000000000000000001", "2026-05-26T10:00:05.000Z"),
    ].join("\n")}\n`,
  );
  const seg1Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000001",
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
      content_hash: seg1RealHash,
    }),
    userMessage("01HEVTA0000000000000000001", "2026-05-26T10:00:05.000Z"),
  ].join("\n")}\n`;

  const seg2Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000002",
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: {
        seq: 2,
        // Tampered: does not match seg1's real content_hash.
        prev_content_hash: "deadbeef".repeat(8),
      },
    }),
    agentMessage("01HEVTA0000000000000000002", "2026-05-26T10:05:05.000Z"),
  ].join("\n")}\n`;

  const result = reconcileSegments([
    { source: "seg1", records: await records(seg1Text) },
    { source: "seg2", records: await records(seg2Text) },
  ]);
  const group = result.groups[0];
  expect(group?.warnings.some((w) => w.code === "segment_chain_mismatch")).toBe(true);
  expect(group?.records).toHaveLength(3); // merge still happens
});

test("intermediate session_terminated{process_terminated} is dropped, terminal one is kept", async () => {
  const seg1Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000001",
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage("01HEVTA0000000000000000001", "2026-05-26T10:00:05.000Z"),
    sessionTerminated(
      "01HEVTA0000000000000000099",
      "2026-05-26T10:00:30.000Z",
      "process_terminated",
    ),
  ].join("\n")}\n`;
  const seg1Hash = await hashOf(seg1Text);

  const seg2Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000002",
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 2, prev_content_hash: seg1Hash },
    }),
    agentMessage("01HEVTA0000000000000000002", "2026-05-26T10:05:05.000Z"),
    sessionTerminated("01HEVTA0000000000000000098", "2026-05-26T10:05:30.000Z", "complete"),
  ].join("\n")}\n`;

  const result = reconcileSegments([
    { source: "seg1", records: await records(seg1Text) },
    { source: "seg2", records: await records(seg2Text) },
  ]);
  const group = result.groups[0];
  expect(group?.intermediate_terminators_dropped).toBe(1);
  // header + user_message + agent_message + terminal session_terminated
  expect(group?.records).toHaveLength(4);
  const types = group?.records.map((r) => (r.value as { type: string }).type);
  expect(types?.[types.length - 1]).toBe("session_terminated");
  expect(
    (group?.records[group.records.length - 1]?.value as { payload: { reason: string } }).payload
      .reason,
  ).toBe("complete");
});

test("two different session_uids → two merged groups returned", async () => {
  const trailA = `${[
    trailHeader({
      id: "01HSESS0000000000000000001",
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
    }),
    userMessage("01HEVTA0000000000000000001", "2026-05-26T10:00:05.000Z"),
  ].join("\n")}\n`;
  const trailB = `${[
    trailHeader({
      id: "01HSESS0000000000000000002",
      ts: "2026-05-26T11:00:00.000Z",
      session_uid: SESSION_UID_B,
    }),
    userMessage("01HEVTA0000000000000000002", "2026-05-26T11:00:05.000Z"),
  ].join("\n")}\n`;

  const result = reconcileSegments([
    { source: "a", records: await records(trailA) },
    { source: "b", records: await records(trailB) },
  ]);
  expect(result.groups).toHaveLength(2);
  const uids = result.groups.map((g) => g.session_uid).sort();
  expect(uids).toEqual([SESSION_UID, SESSION_UID_B].sort());
});

test("segment.prev_content_hash null → segment_chain_unverifiable warning, merge proceeds", async () => {
  const seg1Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000001",
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage("01HEVTA0000000000000000001", "2026-05-26T10:00:05.000Z"),
  ].join("\n")}\n`;

  const seg2Text = `${[
    trailHeader({
      id: "01HSESS0000000000000000002",
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 2, prev_content_hash: null },
    }),
    agentMessage("01HEVTA0000000000000000002", "2026-05-26T10:05:05.000Z"),
  ].join("\n")}\n`;

  const result = reconcileSegments([
    { source: "seg1", records: await records(seg1Text) },
    { source: "seg2", records: await records(seg2Text) },
  ]);
  const group = result.groups[0];
  expect(group?.warnings.some((w) => w.code === "segment_chain_unverifiable")).toBe(true);
  expect(group?.records).toHaveLength(3);
});

test("missing session_uid on multi-segment input → missing_session_uid warning at result level", async () => {
  const segText = `${[
    trailHeader({
      id: "01HSESS0000000000000000001",
      ts: "2026-05-26T10:00:00.000Z",
      segment: { seq: 2, prev_content_hash: "00".repeat(32) },
    }),
    agentMessage("01HEVTA0000000000000000002", "2026-05-26T10:05:05.000Z"),
  ].join("\n")}\n`;

  const result = reconcileSegments([{ source: "orphan", records: await records(segText) }]);
  expect(result.warnings.some((w) => w.code === "missing_session_uid")).toBe(true);
});
