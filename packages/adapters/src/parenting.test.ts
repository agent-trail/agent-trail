import { expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
import { type ParentableEntry, resolveEntryParents } from "./parenting.ts";

function makeEntry(id: string): Entry {
  return {
    type: "user_message",
    id,
    ts: "2026-01-01T00:00:00.000Z",
    payload: { text: id },
  } as Entry;
}

function makeParentable(
  id: string,
  parentSourceId: string | null | undefined,
  localParentId?: string,
): ParentableEntry {
  return { entry: makeEntry(id), parentSourceId, localParentId };
}

test("resolveEntryParents leaves entry untouched when parentSourceId is null/undefined", () => {
  const built: ParentableEntry[] = [makeParentable("e1", null), makeParentable("e2", undefined)];
  const out = resolveEntryParents(built, new Map(), new Map());
  expect(out[0]?.parent_id).toBeUndefined();
  expect(out[1]?.parent_id).toBeUndefined();
});

test("resolveEntryParents resolves direct source id to last entry id", () => {
  const built: ParentableEntry[] = [makeParentable("e2", "src-1")];
  const sourceIdToLastEntryId = new Map<string, string>([["src-1", "e1"]]);
  const out = resolveEntryParents(built, new Map(), sourceIdToLastEntryId);
  expect(out[0]?.parent_id).toBe("e1");
});

test("resolveEntryParents walks the source-id chain when intermediate envelopes emit no entries", () => {
  // src-3 -> src-2 -> src-1; only src-1 has an emitted entry.
  const built: ParentableEntry[] = [makeParentable("e2", "src-3")];
  const parentBySourceId = new Map<string, string | null>([
    ["src-3", "src-2"],
    ["src-2", "src-1"],
    ["src-1", null],
  ]);
  const sourceIdToLastEntryId = new Map<string, string>([["src-1", "e1"]]);
  const out = resolveEntryParents(built, parentBySourceId, sourceIdToLastEntryId);
  expect(out[0]?.parent_id).toBe("e1");
});

test("resolveEntryParents returns undefined when chain dead-ends with no emitted entries", () => {
  const built: ParentableEntry[] = [makeParentable("e1", "src-2")];
  const parentBySourceId = new Map<string, string | null>([
    ["src-2", "src-1"],
    ["src-1", null],
  ]);
  const out = resolveEntryParents(built, parentBySourceId, new Map());
  expect(out[0]?.parent_id).toBeUndefined();
});

test("resolveEntryParents cycle guard prevents infinite loop and returns undefined", () => {
  const built: ParentableEntry[] = [makeParentable("e1", "src-a")];
  const parentBySourceId = new Map<string, string | null>([
    ["src-a", "src-b"],
    ["src-b", "src-a"],
  ]);
  const out = resolveEntryParents(built, parentBySourceId, new Map());
  expect(out[0]?.parent_id).toBeUndefined();
});

test("resolveEntryParents short-circuits on localParentId without consulting source maps", () => {
  const built: ParentableEntry[] = [makeParentable("e2", "src-should-be-ignored", "local-parent")];
  const sourceIdToLastEntryId = new Map<string, string>([["src-should-be-ignored", "wrong"]]);
  const out = resolveEntryParents(built, new Map(), sourceIdToLastEntryId);
  expect(out[0]?.parent_id).toBe("local-parent");
});
