import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const INLINE_MEDIA_MAX_DECODED_BYTES = 1024 * 1024;

export type CappedBase64Decode = {
  bytes?: Buffer;
  oversized?: true;
};

export function decodeCappedBase64(data: string): CappedBase64Decode {
  const compact = data.replace(/\s+/g, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const decodedBytes = Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
  if (decodedBytes > INLINE_MEDIA_MAX_DECODED_BYTES) return { oversized: true };
  return { bytes: Buffer.from(compact, "base64") };
}

export function sha256Ref(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
