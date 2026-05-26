import { expect, test } from "bun:test";
import {
  CLAUDE_CODE_SESSION_UID_NAMESPACE,
  deriveSessionUid,
  PI_SESSION_UID_NAMESPACE,
} from "./session-uid.ts";

const UUID_HYPHENATED = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("deriveSessionUid: same namespace + upstream id → same output across calls", () => {
  const a = deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, "upstream-sess-abc");
  const b = deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, "upstream-sess-abc");
  expect(a).toBe(b);
});

test("deriveSessionUid: output is a v5 hyphenated UUID (RFC 4122 variant)", () => {
  const uid = deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, "upstream-sess-abc");
  expect(uid).toMatch(UUID_HYPHENATED);
});

test("deriveSessionUid: different upstream ids → different uids", () => {
  const a = deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, "sess-1");
  const b = deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, "sess-2");
  expect(a).not.toBe(b);
});

test("deriveSessionUid: same upstream id, different namespaces → different uids", () => {
  const upstream = "shared-session-id";
  const cc = deriveSessionUid(CLAUDE_CODE_SESSION_UID_NAMESPACE, upstream);
  const pi = deriveSessionUid(PI_SESSION_UID_NAMESPACE, upstream);
  expect(cc).not.toBe(pi);
});

test("deriveSessionUid: matches RFC 4122 v5 spec for a known fixture", () => {
  // Reference: uuidv5("agent-trail-test", "00000000-0000-0000-0000-000000000000")
  // computed independently. Pinning the algorithm so future refactors don't
  // accidentally change the bit-twiddling.
  const NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122 DNS namespace
  const uid = deriveSessionUid(NS, "python.org");
  expect(uid).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
});
