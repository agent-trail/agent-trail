import type { Attachment } from "@agent-trail/types";
import { arrayValue, objectValue, type Raw, stringValue } from "./source.ts";

export function attachmentFrom(raw: Raw): Attachment {
  const mime = stringValue(raw.mime) ?? stringValue(raw.mediaType);
  const url = stringValue(raw.url) ?? stringValue(raw.uri);
  const filename = stringValue(raw.filename) ?? stringValue(raw.name);
  return {
    kind: mime?.startsWith("image/") ? "image" : mime !== undefined ? "file" : "other",
    ...(mime !== undefined ? { media_type: mime } : {}),
    ...(url !== undefined && /^(https:|file:|sha256:)/.test(url) ? { uri: url } : {}),
    ...(filename !== undefined ? { name: filename } : {}),
  };
}

export function attachmentsFrom(value: unknown): Attachment[] {
  const rawItems = arrayValue(value);
  if (rawItems === undefined) return [];
  return rawItems.flatMap((item) => {
    const raw = objectValue(item);
    return raw === undefined ? [] : [attachmentFrom(raw)];
  });
}
