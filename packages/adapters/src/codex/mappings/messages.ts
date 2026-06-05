import { Buffer } from "node:buffer";
import type { MappingDef } from "@agent-trail/adapter-kit";
import { defineMapping } from "@agent-trail/adapter-kit";
import type { Attachment } from "@agent-trail/types";
import {
  decodeCappedBase64,
  INLINE_MEDIA_MAX_DECODED_BYTES,
  sha256Ref,
} from "../../inline-media.ts";
import { isObject, stringValue } from "../source.ts";
import { emittable, meta, payloadOf, RAW_TYPE, type Raw, source } from "./shared.ts";

export const IMAGE_CARRIER = "x-codex/_images";
export const INLINE_IMAGE_MAX_DECODED_BYTES = INLINE_MEDIA_MAX_DECODED_BYTES;

type CarriedImages = { role?: string; text: string; attachments: Attachment[] };

type ParsedDataUri = { mediaType?: string; bytes?: Buffer; oversized?: true };

function message(payloadType: "user_message" | "agent_message"): MappingDef<Raw> {
  const rawType = `event_msg.${payloadType}`;
  return defineMapping<Raw>({
    match: { type: "event_msg", payload: { type: payloadType } },
    emit: (record) => {
      if (!emittable(record)) return [];
      const p = payloadOf(record);
      // Canonical surface is `payload.message` (User/AgentMessageEvent.message);
      // no `text` fallback (drift-defense: audited single source).
      const text = stringValue(p.message);
      if (text === undefined || text.length === 0) return [];
      return [
        {
          type: payloadType === "user_message" ? "user_message" : "agent_message",
          payload: { text },
          source: source(rawType),
          meta: meta(rawType),
        },
      ];
    },
  });
}

function parseBase64Image(mediaType: string | undefined, data: string): ParsedDataUri {
  const decoded = decodeCappedBase64(data);
  if (decoded.oversized === true) {
    return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
  }
  return {
    ...(mediaType !== undefined ? { mediaType } : {}),
    bytes: decoded.bytes,
  };
}

// Pull bytes + media type out of a `data:<media-type>;base64,...` URI.
function parseDataUri(uri: string): ParsedDataUri | undefined {
  const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/s.exec(uri);
  if (match === null) return undefined;
  const mediaType = match[1];
  const parameters = match[2] as string;
  const data = match[3] as string;
  if (parameters.split(";").includes("base64")) {
    return parseBase64Image(mediaType, data);
  }
  if (data.length > INLINE_IMAGE_MAX_DECODED_BYTES * 3) {
    return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
  }
  try {
    const decoded = decodeURIComponent(data);
    if (Buffer.byteLength(decoded, "utf8") > INLINE_IMAGE_MAX_DECODED_BYTES) {
      return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
    }
    return {
      ...(mediaType !== undefined ? { mediaType } : {}),
      bytes: Buffer.from(decoded, "utf8"),
    };
  } catch {
    if (Buffer.byteLength(data, "utf8") > INLINE_IMAGE_MAX_DECODED_BYTES) {
      return { ...(mediaType !== undefined ? { mediaType } : {}), oversized: true };
    }
    return { ...(mediaType !== undefined ? { mediaType } : {}), bytes: Buffer.from(data, "utf8") };
  }
}

function attachmentRef(uri: string): { mediaType?: string; uri?: string } | undefined {
  if (/^(https:|file:|sha256:)/.test(uri)) return { uri };
  const parsed = parseDataUri(uri);
  if (parsed === undefined) return undefined;
  return {
    ...(parsed.mediaType !== undefined ? { mediaType: parsed.mediaType } : {}),
    ...(parsed.bytes !== undefined ? { uri: sha256Ref(parsed.bytes) } : {}),
  };
}

// Build spec `attachments[]` from a response_item.message content array. Codex
// images appear as `input_image` (Responses API, `image_url` is a data: URI) or
// `image` (`{ source: { media_type, data } }`). Non-image blocks are ignored.
function imageAttachments(content: unknown): Attachment[] {
  if (!Array.isArray(content)) return [];
  const out: Attachment[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    const type = stringValue(block.type);
    if (type !== "input_image" && type !== "image") continue;
    const src = isObject(block.source) ? block.source : undefined;
    const uri = stringValue(block.image_url) ?? stringValue(src?.url);
    let ref = uri !== undefined ? attachmentRef(uri) : undefined;
    let mediaType = ref?.mediaType ?? stringValue(src?.media_type);
    if (ref === undefined && src !== undefined) {
      const mt = mediaType;
      const data = stringValue(src.data);
      const parsed = data !== undefined ? parseBase64Image(mt, data) : undefined;
      if (parsed !== undefined) {
        ref = parsed.bytes !== undefined ? { uri: sha256Ref(parsed.bytes) } : {};
        if (parsed.mediaType !== undefined) mediaType = parsed.mediaType;
      }
    }
    if (ref?.uri === undefined) continue;
    const attachment: Attachment = { kind: "image" };
    if (mediaType !== undefined) attachment.media_type = mediaType;
    attachment.uri = ref.uri;
    out.push(attachment);
  }
  return out;
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isObject)
    .map((b) => (/text/.test(String(b.type)) ? (stringValue(b.text) ?? "") : ""))
    .join("");
}

// `response_item.message` is the Responses-API conversation item. Its text
// duplicates the `event_msg.{user,agent}_message` the adapter already emits, so
// text-only ones are suppressed. Image-bearing ones carry content that is NOT in
// the (text-only) event_msg echo, so they map to a transient IMAGE_CARRIER whose
// attachments `codexImageRollup` folds into the matching message.
const responseItemMessage = defineMapping<Raw>({
  match: { type: "response_item", payload: { type: "message" } },
  emit: (record) => {
    if (!emittable(record)) return [];
    const p = payloadOf(record);
    const attachments = imageAttachments(p.content);
    if (attachments.length === 0) return []; // text-only -> suppress (duplicate)
    const carried: CarriedImages = {
      attachments,
      text: textFromMessageContent(p.content),
      ...(stringValue(p.role) !== undefined ? { role: stringValue(p.role) } : {}),
    };
    return [
      {
        type: "system_event",
        payload: { kind: IMAGE_CARRIER, text: "" },
        source: source("response_item.message"),
        meta: { [RAW_TYPE]: "response_item.message", [IMAGE_CARRIER]: carried },
      },
    ];
  },
});

export const messageMappings: MappingDef<Raw>[] = [
  message("user_message"),
  message("agent_message"),
  responseItemMessage,
];
