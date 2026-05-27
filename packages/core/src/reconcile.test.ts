import { expect, test } from "bun:test";
import { canonicalizeRecords, computeContentHash, stampTrail } from "./hash.ts";
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
  stream?: { state: "open" | "closed"; started_at?: string };
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
  if (opts.stream !== undefined) header.stream = opts.stream;
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
  // header + user_message + agent_message + terminal session_terminated
  // (intermediate process_terminated marker from seg1 is dropped)
  expect(group?.records).toHaveLength(4);
  const types = group?.records.map((r) => (r.value as { type: string }).type);
  expect(types?.[types.length - 1]).toBe("session_terminated");
  expect(
    (group?.records[group.records.length - 1]?.value as { payload: { reason: string } }).payload
      .reason,
  ).toBe("complete");
  // Explicit assertion that no intermediate process_terminated markers
  // survived the merge — record count alone is an indirect proxy.
  const intermediateTerminators = group?.records.filter(
    (r) =>
      (r.value as { type: string }).type === "session_terminated" &&
      (r.value as { payload?: { reason?: string } }).payload?.reason === "process_terminated",
  );
  expect(intermediateTerminators).toHaveLength(0);
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

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip property — #73 Verification §1
//
// Capture one uninterrupted session as a reference trail. Capture the same
// session sliced into 4 segments with daemon "kills" at 3 points (each
// non-final segment finalized with a `process_terminated` marker, every
// boundary repeating the prior segment's last event to exercise dedup).
// Reconciler output must be byte-equal to the reference trail's canonical
// bytes, modulo the dropped intermediate terminators.
// ─────────────────────────────────────────────────────────────────────────────

test("round-trip: 4-segment capture with kills at 3 points reconciles to bytes-equal reference (modulo intermediate terminators)", async () => {
  const HEADER_ID = "01HSESS0000000000000000777";
  const SUID = "01HSESSUID7777777777777777";
  const START_TS = "2026-05-26T10:00:00.000Z";

  // 8 events alternating user/agent. Ids are 26-char Crockford ULIDs.
  const e1 = userMessage("01HEVT000000000000000000A1", "2026-05-26T10:00:05.000Z", "m1");
  const e2 = agentMessage("01HEVT000000000000000000A2", "2026-05-26T10:00:10.000Z", "m2");
  const e3 = userMessage("01HEVT000000000000000000A3", "2026-05-26T10:00:15.000Z", "m3");
  const e4 = agentMessage("01HEVT000000000000000000A4", "2026-05-26T10:00:20.000Z", "m4");
  const e5 = userMessage("01HEVT000000000000000000A5", "2026-05-26T10:00:25.000Z", "m5");
  const e6 = agentMessage("01HEVT000000000000000000A6", "2026-05-26T10:00:30.000Z", "m6");
  const e7 = userMessage("01HEVT000000000000000000A7", "2026-05-26T10:00:35.000Z", "m7");
  const e8 = agentMessage("01HEVT000000000000000000A8", "2026-05-26T10:00:40.000Z", "m8");
  const finalTerm = sessionTerminated(
    "01HEVT888888888888888888TT",
    "2026-05-26T10:00:50.000Z",
    "complete",
  );

  // Reference: uninterrupted single-segment trail.
  const referenceText = `${[
    trailHeader({ id: HEADER_ID, ts: START_TS, session_uid: SUID }),
    e1,
    e2,
    e3,
    e4,
    e5,
    e6,
    e7,
    e8,
    finalTerm,
  ].join("\n")}\n`;
  const referenceRecords = await records(referenceText);
  stampTrail(referenceRecords);
  const referenceCanonical = canonicalizeRecords(referenceRecords);
  const referenceContentHash = (referenceRecords[0]?.value as { content_hash: string })
    .content_hash;

  // Helper: take a draft segment, stamp it, return the stamped text + its hash
  // so the next segment can chain back to it via prev_content_hash.
  async function stampSegment(
    seq: number,
    prev: string | undefined,
    eventLines: string[],
    terminator: string,
  ): Promise<{ text: string; hash: string }> {
    const segment: { seq: number; prev_content_hash?: string } = { seq };
    if (prev !== undefined) segment.prev_content_hash = prev;
    const draft = `${[
      trailHeader({ id: HEADER_ID, ts: START_TS, session_uid: SUID, segment }),
      ...eventLines,
      terminator,
    ].join("\n")}\n`;
    const draftRecords = await records(draft);
    stampTrail(draftRecords);
    const hash = (draftRecords[0]?.value as { content_hash: string }).content_hash;
    const stampedText = `${[
      trailHeader({
        id: HEADER_ID,
        ts: START_TS,
        session_uid: SUID,
        segment,
        content_hash: hash,
      }),
      ...eventLines,
      terminator,
    ].join("\n")}\n`;
    return { text: stampedText, hash };
  }

  const kill1 = sessionTerminated(
    "01HEVT999000000000000000K1",
    "2026-05-26T10:00:16.000Z",
    "process_terminated",
  );
  const kill2 = sessionTerminated(
    "01HEVT999000000000000000K2",
    "2026-05-26T10:00:26.000Z",
    "process_terminated",
  );
  const kill3 = sessionTerminated(
    "01HEVT999000000000000000K3",
    "2026-05-26T10:00:36.000Z",
    "process_terminated",
  );

  // Boundary overlap: each non-first segment repeats the previous segment's
  // last event so dedup has work to do. Overlapping events: e3, e5, e7.
  const seg1 = await stampSegment(1, undefined, [e1, e2, e3], kill1);
  const seg2 = await stampSegment(2, seg1.hash, [e3, e4, e5], kill2);
  const seg3 = await stampSegment(3, seg2.hash, [e5, e6, e7], kill3);
  const seg4 = await stampSegment(4, seg3.hash, [e7, e8], finalTerm);

  const result = reconcileSegments([
    { source: "seg1", records: await records(seg1.text) },
    { source: "seg2", records: await records(seg2.text) },
    { source: "seg3", records: await records(seg3.text) },
    { source: "seg4", records: await records(seg4.text) },
  ]);

  expect(result.warnings).toEqual([]);
  expect(result.groups).toHaveLength(1);
  const group = result.groups[0];
  if (group === undefined) throw new Error("expected one merged group");

  expect(group.warnings).toEqual([]);
  expect(group.segments).toEqual(["seg1", "seg2", "seg3", "seg4"]);
  expect(group.events_deduped).toBe(3);

  // The round-trip property: merged canonical bytes equal the reference.
  expect(group.canonical).toBe(referenceCanonical);

  // Diagnostic assertions — survive even if byte-equality drifts so future
  // regressions point at the specific divergence.
  const mergedHeader = group.records[0]?.value as Record<string, unknown>;
  expect(mergedHeader.content_hash).toBe(referenceContentHash);
  expect(mergedHeader.segment).toBeUndefined();
  expect(mergedHeader.session_uid).toBe(SUID);
  expect(mergedHeader.ts).toBe(START_TS);

  const mergedEventIds = group.records.slice(1).map((r) => (r.value as { id: string }).id);
  expect(mergedEventIds).toEqual([
    "01HEVT000000000000000000A1",
    "01HEVT000000000000000000A2",
    "01HEVT000000000000000000A3",
    "01HEVT000000000000000000A4",
    "01HEVT000000000000000000A5",
    "01HEVT000000000000000000A6",
    "01HEVT000000000000000000A7",
    "01HEVT000000000000000000A8",
    "01HEVT888888888888888888TT",
  ]);

  const lastRecord = group.records[group.records.length - 1]?.value as {
    type: string;
    payload: { reason: string };
  };
  expect(lastRecord.type).toBe("session_terminated");
  expect(lastRecord.payload.reason).toBe("complete");
});

test("open final segment: merged header keeps stream.state open and omits content_hash", async () => {
  const HEADER_ID = "01HSESS0000000000000000888";
  const SUID = "01HSESSUID8888888888888888";
  const START_TS = "2026-05-26T11:00:00.000Z";

  // Seg-1: finalized, real content_hash stamped.
  const seg1Draft = `${[
    trailHeader({
      id: HEADER_ID,
      ts: START_TS,
      session_uid: SUID,
      segment: { seq: 1 },
    }),
    userMessage("01HEVT000000000000000000B1", "2026-05-26T11:00:05.000Z", "m1"),
    agentMessage("01HEVT000000000000000000B2", "2026-05-26T11:00:10.000Z", "m2"),
    sessionTerminated(
      "01HEVT999000000000000000K9",
      "2026-05-26T11:00:11.000Z",
      "process_terminated",
    ),
  ].join("\n")}\n`;
  const seg1Records = await records(seg1Draft);
  stampTrail(seg1Records);
  const seg1Hash = (seg1Records[0]?.value as { content_hash: string }).content_hash;

  // Seg-2: still streaming. stream.state: "open", no content_hash on header.
  const seg2Text = `${[
    trailHeader({
      id: HEADER_ID,
      ts: "2026-05-26T11:05:00.000Z",
      session_uid: SUID,
      segment: { seq: 2, prev_content_hash: seg1Hash },
      stream: { state: "open", started_at: "2026-05-26T11:05:00.000Z" },
    }),
    userMessage("01HEVT000000000000000000B3", "2026-05-26T11:05:05.000Z", "m3"),
  ].join("\n")}\n`;

  const result = reconcileSegments([
    { source: "seg1", records: seg1Records },
    { source: "seg2", records: await records(seg2Text) },
  ]);

  expect(result.warnings).toEqual([]);
  const group = result.groups[0];
  if (group === undefined) throw new Error("expected one merged group");
  expect(group.warnings).toEqual([]);

  const mergedHeader = group.records[0]?.value as Record<string, unknown>;

  // Stream state carried over from final (open) segment.
  expect(mergedHeader.stream).toEqual({
    state: "open",
    started_at: "2026-05-26T11:05:00.000Z",
  });

  // Spec §7.3 + validator rule stream_open_with_content_hash: open header
  // MUST NOT carry a populated content_hash. Reconciler must skip the stamp.
  const contentHash = mergedHeader.content_hash;
  expect(contentHash === undefined || contentHash === "<pending>").toBe(true);

  // Canonical bytes match — the merged trail is self-consistent.
  expect(group.canonical).toBe(canonicalizeRecords(group.records));
});

test("multi-session input splits into per-session sub-inputs and reconciles each independently", async () => {
  // One file contains two session groups; another file contains a segment
  // for one of those sessions. After split-then-group, we expect two
  // reconciled output groups: one merged (multi-segment), one pass-through.
  const file1 = `${[
    trailHeader({
      id: "01HSESS000000000000000FILE1",
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage("01HEVT0000000000000000FILE1", "2026-05-26T10:00:05.000Z", "msg1"),
    trailHeader({
      id: "01HSESS000000000000000FILE2",
      ts: "2026-05-26T10:10:00.000Z",
      session_uid: SESSION_UID_B,
    }),
    userMessage("01HEVT0000000000000000FILE2", "2026-05-26T10:10:05.000Z", "msg2"),
  ].join("\n")}\n`;
  const file1Records = await records(file1);
  // Stamp each group's hash so the multi-segment chain check has a real prior hash.
  stampTrail(file1Records);
  // Recover seg1's stamped hash by slicing.
  const seg1OnlyText = `${[
    trailHeader({
      id: "01HSESS000000000000000FILE1",
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage("01HEVT0000000000000000FILE1", "2026-05-26T10:00:05.000Z", "msg1"),
  ].join("\n")}\n`;
  const seg1Hash = await hashOf(seg1OnlyText);

  const file2 = `${[
    trailHeader({
      id: "01HSESS000000000000000FILE3",
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 2, prev_content_hash: seg1Hash },
    }),
    userMessage("01HEVT0000000000000000FILE3", "2026-05-26T10:05:05.000Z", "msg3"),
  ].join("\n")}\n`;
  const file2Records = await records(file2);

  const result = reconcileSegments([
    { source: "file1", records: file1Records },
    { source: "file2", records: file2Records },
  ]);

  expect(result.warnings).toEqual([]);
  expect(result.groups).toHaveLength(2);

  const merged = result.groups.find((g) => g.session_uid === SESSION_UID);
  const passThrough = result.groups.find((g) => g.session_uid === SESSION_UID_B);
  if (merged === undefined || passThrough === undefined) {
    throw new Error("expected both session_uids present");
  }

  // Multi-segment merge: msg1 from file1#0, msg3 from file2.
  const mergedEventTexts = merged.records
    .slice(1)
    .map((r) => (r.value.payload as { text: string }).text);
  expect(mergedEventTexts).toEqual(["msg1", "msg3"]);

  // Pass-through: file1's second session group, unmodified entry count.
  expect(passThrough.records.length).toBeGreaterThan(0);
  const ptEventTexts = passThrough.records
    .slice(1)
    .map((r) => (r.value.payload as { text: string }).text);
  expect(ptEventTexts).toEqual(["msg2"]);
});
