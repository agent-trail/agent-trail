import { claudeCodeAdapter } from "../claude-code/index.ts";
import { codexAdapter } from "../codex/index.ts";
import type { TrailAdapter } from "../index.ts";
import { opencodeAdapter } from "../opencode/index.ts";
import { piAdapter } from "../pi/index.ts";

// Order is user-visible when discovery timestamps tie and doctor renders checks.
const DEFAULT_TRAIL_ADAPTERS: readonly TrailAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  opencodeAdapter,
  piAdapter,
];

export function defaultTrailAdapters(): TrailAdapter[] {
  return [...DEFAULT_TRAIL_ADAPTERS];
}
