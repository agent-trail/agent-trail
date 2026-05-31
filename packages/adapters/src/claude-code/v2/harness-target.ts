import { join } from "node:path";
import type { V2HarnessTarget } from "../../diff-harness/index.ts";
import { claudeCodeAdapter } from "../index.ts";
import { parseClaudeCodeV2Entries } from "./index.ts";

export const claudeCodeV2HarnessTarget: V2HarnessTarget = {
  agent: "claude-code",
  fixturesDir: join(import.meta.dir, "../../../tests/fixtures/claude-code"),
  old: claudeCodeAdapter,
  parseNew: (path, sessionUid) => parseClaudeCodeV2Entries(path, sessionUid),
};
