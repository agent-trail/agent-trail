import { defaultTrailAdapters, type TrailAdapter } from "@agent-trail/adapters";

export type { TrailAdapter };

export function cliDefaultAdapters(): TrailAdapter[] {
  return defaultTrailAdapters();
}

export function cliAdapterByName(
  name: string,
  adapters: readonly TrailAdapter[] = cliDefaultAdapters(),
): TrailAdapter | undefined {
  return adapters.find((adapter) => adapter.name === name);
}

export function cliAdapterNames(
  adapters: readonly TrailAdapter[] = cliDefaultAdapters(),
): string[] {
  return adapters.map((adapter) => adapter.name);
}
