import { expect, test } from "bun:test";
import type { Entry, Header } from "@agent-trail/types";
import { applyHeaderMetadataUpdates } from "./header-metadata.ts";

function header(overrides: Partial<Header> = {}): Header {
  return {
    type: "session",
    schema_version: "0.1.0",
    id: "00000000-0000-0000-0000-000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
    ...overrides,
  };
}

function update(
  field: "name" | "description" | "tags",
  value: string | string[],
  id: string,
): Entry {
  return {
    type: "session_metadata_update",
    id,
    ts: "2026-05-17T14:00:01.000Z",
    payload: { field, value, reason: "ai_generated" },
  } as Entry;
}

test("applyHeaderMetadataUpdates copies first canonical metadata values into empty header fields", () => {
  const h = header();
  applyHeaderMetadataUpdates(h, [
    update("name", "Initial name", "00000000-0000-0000-0000-000000000101"),
    update("name", "Later name", "00000000-0000-0000-0000-000000000102"),
    update("description", "Initial description", "00000000-0000-0000-0000-000000000103"),
    update("tags", ["one", "two"], "00000000-0000-0000-0000-000000000104"),
  ]);

  expect(h.name).toBe("Initial name");
  expect(h.description).toBe("Initial description");
  expect(h.tags).toEqual(["one", "two"]);
});

test("applyHeaderMetadataUpdates preserves existing header metadata", () => {
  const h = header({ name: "Header name", tags: ["header"] });
  applyHeaderMetadataUpdates(h, [
    update("name", "Event name", "00000000-0000-0000-0000-000000000105"),
    update("tags", ["event"], "00000000-0000-0000-0000-000000000106"),
    update("description", "Event description", "00000000-0000-0000-0000-000000000107"),
  ]);

  expect(h.name).toBe("Header name");
  expect(h.tags).toEqual(["header"]);
  expect(h.description).toBe("Event description");
});
