import { claudeCodeAdapter } from "../claude-code/index.ts";
import { codexAdapter } from "../codex/index.ts";
import type { TrailAdapter } from "../index.ts";
import { opencodeAdapter } from "../opencode/index.ts";
import { piAdapter } from "../pi/index.ts";

// Order is user-visible when discovery timestamps tie and doctor renders checks.
export const ADAPTERS: readonly TrailAdapter[] = Object.freeze([
  claudeCodeAdapter,
  codexAdapter,
  opencodeAdapter,
  piAdapter,
]);

export function adapterByName(name: string): TrailAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.name === name);
}

export function defaultTrailAdapters(): TrailAdapter[] {
  return [...ADAPTERS];
}
