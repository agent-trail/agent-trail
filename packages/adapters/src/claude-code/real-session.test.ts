import { claudeCodeAdapter } from "../index.ts";
import { firstJsonlFile, runRealSessionSmoke } from "../test-helpers.ts";
import { claudeCodeConfigDir, claudeCodeProjectsRoot } from "./paths.ts";

function defaultClaudeCodeSessionPath(): string | undefined {
  const configDir = claudeCodeConfigDir();
  if (configDir === undefined) return undefined;
  return firstJsonlFile(claudeCodeProjectsRoot(configDir), (path) =>
    path.split(/[\\/]/).includes("subagents"),
  );
}

// Opt-in real-session test. Hard-skipped in CI and skipped locally unless
// AGENT_TRAIL_REAL_CLAUDE_CODE_SESSION points to a real Claude Code session
// JSONL, or a session exists under Claude Code's default projects dir.
//
//   AGENT_TRAIL_REAL_CLAUDE_CODE_SESSION=/abs/path/to/session.jsonl bun test packages/adapters
runRealSessionSmoke({
  adapter: claudeCodeAdapter,
  envVar: "AGENT_TRAIL_REAL_CLAUDE_CODE_SESSION",
  expectedAgentName: "claude-code",
  fallbackSessionId: "real-claude-code-session",
  defaultSessionPath: defaultClaudeCodeSessionPath,
  testName:
    "real Claude Code session (AGENT_TRAIL_REAL_CLAUDE_CODE_SESSION) parses, validates, and exposes feature coverage",
});
