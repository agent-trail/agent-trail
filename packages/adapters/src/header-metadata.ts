import type { Entry, Header } from "@agent-trail/types";

export function applyHeaderMetadataUpdates(header: Header, entries: Entry[]): Header {
  for (const entry of entries) {
    if (entry.type !== "session_metadata_update") continue;
    const payload = entry.payload;
    if (payload === undefined || typeof payload !== "object" || payload === null) continue;

    if (
      payload.field === "name" &&
      header.name === undefined &&
      typeof payload.value === "string"
    ) {
      header.name = payload.value;
      continue;
    }
    if (
      payload.field === "description" &&
      header.description === undefined &&
      typeof payload.value === "string"
    ) {
      header.description = payload.value;
      continue;
    }
    if (
      payload.field === "tags" &&
      header.tags === undefined &&
      Array.isArray(payload.value) &&
      payload.value.every((tag) => typeof tag === "string")
    ) {
      header.tags = [...payload.value];
    }
  }
  return header;
}
