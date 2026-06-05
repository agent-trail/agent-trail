import { expect, test } from "bun:test";
import { ADAPTERS, adapterByName, defaultTrailAdapters } from "./registry.ts";

test("registry exposes the default adapters in user-visible order", () => {
  expect(ADAPTERS.map((adapter) => adapter.name)).toEqual([
    "claude-code",
    "codex",
    "opencode",
    "pi",
  ]);
});

test("adapterByName resolves by adapter name", () => {
  expect(adapterByName("pi")?.name).toBe("pi");
  expect(adapterByName("missing")).toBeUndefined();
});

test("defaultTrailAdapters returns a mutable copy of the registry", () => {
  const adapters = defaultTrailAdapters();

  expect(adapters.map((adapter) => adapter.name)).toEqual(ADAPTERS.map((adapter) => adapter.name));
  adapters.pop();
  expect(adapters).toHaveLength(ADAPTERS.length - 1);
  expect(ADAPTERS).toHaveLength(4);
});
