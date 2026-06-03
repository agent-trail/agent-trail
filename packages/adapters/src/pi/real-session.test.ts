import { piAdapter } from "../index.ts";
import { firstJsonlFile, runRealSessionSmoke } from "../test-helpers.ts";
import { piSessionsDir } from "./paths.ts";

// Opt-in real-session test. Hard-skipped in CI and skipped locally unless
// AGENT_TRAIL_REAL_PI_SESSION points to a real Pi session JSONL, or a session
// exists under Pi's default sessions dir.
//
//   AGENT_TRAIL_REAL_PI_SESSION=/abs/path/to/session.jsonl bun test packages/adapters
runRealSessionSmoke({
  adapter: piAdapter,
  envVar: "AGENT_TRAIL_REAL_PI_SESSION",
  expectedAgentName: "pi",
  fallbackSessionId: "real-pi-session",
  defaultSessionPath: () => firstJsonlFile(piSessionsDir()),
  testName:
    "real Pi session (AGENT_TRAIL_REAL_PI_SESSION) parses, validates, and exposes feature coverage",
});
