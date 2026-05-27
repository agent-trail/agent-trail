import { expect, test } from "bun:test";
import type { AgentTrailV010, Header, SystemEvent } from "@agent-trail/types";

test("@agent-trail/types exposes generated schema types", () => {
  const header = {
    type: "session",
    schema_version: "0.1.0",
    id: "sess_0001",
    ts: "2026-05-19T00:00:00.000Z",
    agent: {
      name: "codex-cli",
    },
  } satisfies Header;

  const record: AgentTrailV010 = header;

  expect(record.type).toBe("session");
});

// Regression: SystemEvent.payload.kind must accept both reserved values and
// adapter-namespaced `x-<adapter>/<name>` extensions. The pre-fix generator
// output (`(reserved | { [k: string]: unknown }) & string`) silently rejected
// extension kinds because the index-signature branch collapsed to `never`.
test("SystemEvent.payload.kind accepts reserved + x-<adapter>/<name> extensions", () => {
  const reserved = {
    type: "system_event",
    payload: { kind: "heartbeat" },
  } satisfies SystemEvent;
  const extension = {
    type: "system_event",
    payload: { kind: "x-claudecode/diag" },
  } satisfies SystemEvent;
  const another = {
    type: "system_event",
    payload: { kind: "x-pi/custom_message" },
  } satisfies SystemEvent;
  expect(reserved.payload?.kind).toBe("heartbeat");
  expect(extension.payload?.kind).toBe("x-claudecode/diag");
  expect(another.payload?.kind).toBe("x-pi/custom_message");
});
