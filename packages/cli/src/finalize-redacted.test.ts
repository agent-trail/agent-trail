import { expect, test } from "bun:test";
import { computeContentHash, parseJsonlString, verifyContentHash } from "@agent-trail/core";
import { finalizeRedactedTrail } from "./finalize-redacted.ts";

test("stamps with sessionHash when session header is present", async () => {
  const header = {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
    cwd: "/work/proj-a",
    content_hash: "<pending>",
  };
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hello" },
  };
  const records = await parseJsonlString(`${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`);

  const { canonical, contentHash } = finalizeRedactedTrail(records);

  expect(contentHash).not.toBe("<pending>");
  expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
  const stamped = await parseJsonlString(canonical);
  const verified = verifyContentHash(stamped);
  expect(verified.status).toBe("match");
  expect(verified.actual).toBe(contentHash);
});

test("falls back to computeContentHash when no session header is stampable", async () => {
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: "hi" },
  };
  const records = await parseJsonlString(`${JSON.stringify(userMsg)}\n`);
  const expected = computeContentHash(records);

  const { contentHash } = finalizeRedactedTrail(records);

  expect(contentHash).toBe(expected);
});
