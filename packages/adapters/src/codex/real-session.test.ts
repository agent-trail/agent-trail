import { expect, test } from "bun:test";
import { codexAdapter, validateAdapterTrail } from "../index.ts";

// Opt-in real-session test (issue #32). Reads a path from
// `AGENT_TRAIL_REAL_CODEX_SESSION` env var and runs the Codex adapter against a
// real Codex CLI session JSONL on the contributor's machine. Skipped when the
// env var is unset — real local sessions stay out of git per the fixture
// policy in `docs/parser-source-matrix.md`. This test never reads the file in
// CI; opt in locally:
//
//   AGENT_TRAIL_REAL_CODEX_SESSION=/abs/path/to/rollout-...jsonl bun test packages/adapters
const realPath = process.env.AGENT_TRAIL_REAL_CODEX_SESSION;

test.skipIf(realPath === undefined || realPath.length === 0)(
  "real Codex session (AGENT_TRAIL_REAL_CODEX_SESSION) parses and validates with zero error diagnostics",
  async () => {
    if (realPath === undefined) return;
    const trail = await codexAdapter.parseSession({
      id: "real-codex-session",
      adapter: "codex",
      path: realPath,
    });
    expect(trail.header.agent.name).toBe("codex-cli");
    for (const entry of trail.entries) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.ts).toBe("string");
      expect(typeof entry.type).toBe("string");
    }
    const diagnostics = await validateAdapterTrail(trail);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  },
);
