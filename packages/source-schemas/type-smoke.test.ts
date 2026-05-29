import { expect, test } from "bun:test";
import type { ClaudeCodeV1Record } from "./claude-code/v1.d.ts";
import type { CodexV0_128Record } from "./codex/v0.128.d.ts";
import type { PiV1Record } from "./pi/v1.d.ts";

test("generated source types discriminate on the record type field", () => {
  const codex: CodexV0_128Record = { type: "session_meta", payload: { id: "x" } };
  const pi: PiV1Record = { type: "session" };
  const cc: ClaudeCodeV1Record = { type: "user", version: "1.0.0" };

  expect(codex.type).toBe("session_meta");
  expect(pi.type).toBe("session");
  expect(cc.type).toBe("user");
});
