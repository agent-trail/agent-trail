import { join } from "node:path";
import type { V2HarnessTarget } from "../../diff-harness/index.ts";
import { codexAdapter } from "../index.ts";
import { parseCodexV2Entries } from "./index.ts";

export const codexV2HarnessTarget: V2HarnessTarget = {
  agent: "codex",
  fixturesDir: join(import.meta.dir, "../../../tests/fixtures/codex"),
  old: codexAdapter,
  parseNew: (path, sessionUid) => parseCodexV2Entries(path, sessionUid),
};
