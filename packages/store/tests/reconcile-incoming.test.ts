import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonlString, stampTrail } from "@agent-trail/core";
import { objectPath, reconcileIncomingSegment, registerTrail } from "../src/index.ts";

let storeRoot: string;
let scratch: string;
let SESSION_UID: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "trail-store-recin-"));
  scratch = mkdtempSync(join(tmpdir(), "trail-recin-scratch-"));
  SESSION_UID = randomUUID();
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

function header(opts: {
  id: string;
  ts: string;
  session_uid?: string;
  segment?: { seq: number; prev_content_hash?: string };
}): string {
  const h: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: opts.id,
    ts: opts.ts,
    agent: { name: "codex-cli" },
  };
  if (opts.session_uid !== undefined) h.session_uid = opts.session_uid;
  if (opts.segment !== undefined) h.segment = opts.segment;
  return JSON.stringify(h);
}

function userMessage(id: string, ts: string, text = "hello"): string {
  return JSON.stringify({ type: "user_message", id, ts, payload: { text } });
}

function agentMessage(id: string, ts: string, text = "hi"): string {
  return JSON.stringify({ type: "agent_message", id, ts, payload: { text } });
}

async function stampedTrail(lines: string[]): Promise<{ text: string; hash: string }> {
  const draft = `${lines.join("\n")}\n`;
  const records = await parseJsonlString(draft);
  stampTrail(records);
  const hash = (records[0]?.value as { content_hash: string }).content_hash;
  const stampedHeader = JSON.parse(lines[0] as string) as Record<string, unknown>;
  stampedHeader.content_hash = hash;
  const stampedLines = [JSON.stringify(stampedHeader), ...lines.slice(1)];
  return { text: `${stampedLines.join("\n")}\n`, hash };
}

async function seedPriorSegment(text: string): Promise<string> {
  const path = join(scratch, `seg-${randomUUID()}.trail.jsonl`);
  await writeFile(path, text, "utf8");
  const reg = await registerTrail(path, { storeRoot });
  if (reg.status !== "finalized" && reg.status !== "already_present") {
    throw new Error(
      `seed register unexpected status: ${reg.status} (${reg.diagnostics.map((d) => d.message).join("; ")})`,
    );
  }
  if (reg.contentHash === null) {
    throw new Error(`seed register failed: ${reg.diagnostics.map((d) => d.message).join("; ")}`);
  }
  return reg.contentHash;
}

test("passthrough with reason=no_session_uid when incoming has no session_uid", async () => {
  const incoming = `${[
    header({ id: randomUUID(), ts: "2026-05-26T10:00:00.000Z" }),
    userMessage(randomUUID(), "2026-05-26T10:00:05.000Z"),
  ].join("\n")}\n`;
  const outcome = await reconcileIncomingSegment(storeRoot, incoming);
  expect(outcome.kind).toBe("passthrough");
  if (outcome.kind === "passthrough") {
    expect(outcome.reason).toBe("no_session_uid");
  }
});

test("passthrough (no reason) when session_uid is present but store has no priors", async () => {
  const incoming = `${[
    header({
      id: randomUUID(),
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage(randomUUID(), "2026-05-26T10:00:05.000Z"),
  ].join("\n")}\n`;
  const outcome = await reconcileIncomingSegment(storeRoot, incoming);
  expect(outcome.kind).toBe("passthrough");
  if (outcome.kind === "passthrough") {
    expect(outcome.reason).toBeUndefined();
  }
});

test("merged outcome when one prior segment matches by session_uid", async () => {
  // Multi-segment trails share a stable header id across segments; the reconciler
  // flags id divergence as `stable_field_divergence` otherwise.
  const HEADER_ID = randomUUID();
  const seg1 = await stampedTrail([
    header({
      id: HEADER_ID,
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage(randomUUID(), "2026-05-26T10:00:05.000Z"),
  ]);
  await seedPriorSegment(seg1.text);

  const incoming = `${[
    header({
      id: HEADER_ID,
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 2, prev_content_hash: seg1.hash },
    }),
    agentMessage(randomUUID(), "2026-05-26T10:05:05.000Z"),
  ].join("\n")}\n`;

  const outcome = await reconcileIncomingSegment(storeRoot, incoming);
  expect(outcome.kind).toBe("merged");
  if (outcome.kind !== "merged") return;
  expect(outcome.group.segments).toHaveLength(2);
  expect(outcome.group.segments).toContain("incoming");
  expect(outcome.group.session_uid).toBe(SESSION_UID);
  expect(outcome.group.warnings).toEqual([]);
  expect(outcome.canonical.length).toBeGreaterThan(0);
});

test("chain mismatch surfaces as a warning on the merged group, merge still proceeds", async () => {
  const HEADER_ID = randomUUID();
  const seg1 = await stampedTrail([
    header({
      id: HEADER_ID,
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage(randomUUID(), "2026-05-26T10:00:05.000Z"),
  ]);
  await seedPriorSegment(seg1.text);

  // Incoming segment lies about the prior content_hash.
  const incoming = `${[
    header({
      id: HEADER_ID,
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 2, prev_content_hash: "deadbeef".repeat(8) },
    }),
    agentMessage(randomUUID(), "2026-05-26T10:05:05.000Z"),
  ].join("\n")}\n`;

  const outcome = await reconcileIncomingSegment(storeRoot, incoming);
  expect(outcome.kind).toBe("merged");
  if (outcome.kind !== "merged") return;
  expect(outcome.group.warnings.some((w) => w.code === "segment_chain_mismatch")).toBe(true);
});

test("passthrough with reason=invalid_incoming when incoming JSONL is unparseable", async () => {
  const outcome = await reconcileIncomingSegment(storeRoot, "not valid jsonl\n{broken");
  expect(outcome.kind).toBe("passthrough");
  if (outcome.kind === "passthrough") {
    expect(outcome.reason).toBe("invalid_incoming");
  }
});

test("passthrough with reason=corrupt_prior when prior object file is missing", async () => {
  const HEADER_ID = randomUUID();
  const seg1 = await stampedTrail([
    header({
      id: HEADER_ID,
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage(randomUUID(), "2026-05-26T10:00:05.000Z"),
  ]);
  const priorHash = await seedPriorSegment(seg1.text);
  // Delete the stored object so the index still points at it but the file
  // can no longer be read.
  await rm(objectPath(storeRoot, priorHash), { force: true });

  const incoming = `${[
    header({
      id: HEADER_ID,
      ts: "2026-05-26T10:05:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 2, prev_content_hash: seg1.hash },
    }),
    agentMessage(randomUUID(), "2026-05-26T10:05:05.000Z"),
  ].join("\n")}\n`;

  const outcome = await reconcileIncomingSegment(storeRoot, incoming);
  expect(outcome.kind).toBe("passthrough");
  if (outcome.kind === "passthrough") {
    expect(outcome.reason).toBe("corrupt_prior");
  }
});

test("passthrough when an unrelated session_uid is in the store but no priors match", async () => {
  const unrelated = await stampedTrail([
    header({
      id: randomUUID(),
      ts: "2026-05-26T09:00:00.000Z",
      session_uid: randomUUID(),
      segment: { seq: 1 },
    }),
    userMessage(randomUUID(), "2026-05-26T09:00:05.000Z"),
  ]);
  await seedPriorSegment(unrelated.text);

  const incoming = `${[
    header({
      id: randomUUID(),
      ts: "2026-05-26T10:00:00.000Z",
      session_uid: SESSION_UID,
      segment: { seq: 1 },
    }),
    userMessage(randomUUID(), "2026-05-26T10:00:05.000Z"),
  ].join("\n")}\n`;

  const outcome = await reconcileIncomingSegment(storeRoot, incoming);
  expect(outcome.kind).toBe("passthrough");
});
