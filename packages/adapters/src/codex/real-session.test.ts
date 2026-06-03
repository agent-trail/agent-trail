import { codexAdapter } from "../index.ts";
import { firstJsonlFile, runRealSessionSmoke } from "../test-helpers.ts";
import { codexSessionsDir } from "./paths.ts";

// Opt-in real-session test. Hard-skipped in CI and skipped locally unless
// AGENT_TRAIL_REAL_CODEX_SESSION points to a real Codex session JSONL, or a
// session exists under Codex's default sessions dir.
//
//   AGENT_TRAIL_REAL_CODEX_SESSION=/abs/path/to/rollout-...jsonl bun test packages/adapters
runRealSessionSmoke({
  adapter: codexAdapter,
  envVar: "AGENT_TRAIL_REAL_CODEX_SESSION",
  expectedAgentName: "codex-cli",
  fallbackSessionId: "real-codex-session",
  defaultSessionPath: () => firstJsonlFile(codexSessionsDir()),
  testName:
    "real Codex session (AGENT_TRAIL_REAL_CODEX_SESSION) parses, validates, and exposes feature coverage",
});
