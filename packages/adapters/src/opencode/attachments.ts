import type { Attachment } from "@agent-trail/types";
import { arrayValue, objectValue, type Raw, stringValue } from "./source.ts";

export function attachmentFrom(raw: Raw): Attachment | undefined {
  const mime = stringValue(raw.mime) ?? stringValue(raw.mediaType);
  const url = stringValue(raw.url) ?? stringValue(raw.uri);
  const filename = stringValue(raw.filename) ?? stringValue(raw.name);
  const uri = url !== undefined && /^(https:|file:|sha256:)/.test(url) ? url : undefined;
  if (uri === undefined && filename === undefined) return undefined;
  const kind = mime?.startsWith("image/") ? "image" : mime !== undefined ? "file" : "other";
  const media_type = mime;
  if (uri !== undefined) {
    return {
      kind,
      ...(media_type !== undefined ? { media_type } : {}),
      uri,
      ...(filename !== undefined ? { name: filename } : {}),
    };
  }
  return {
    kind,
    ...(media_type !== undefined ? { media_type } : {}),
    name: filename as string,
  };
}

export function attachmentsFrom(value: unknown): Attachment[] {
  const rawItems = arrayValue(value);
  if (rawItems === undefined) return [];
  return rawItems.flatMap((item) => {
    const raw = objectValue(item);
    if (raw === undefined) return [];
    const attachment = attachmentFrom(raw);
    return attachment === undefined ? [] : [attachment];
  });
}
