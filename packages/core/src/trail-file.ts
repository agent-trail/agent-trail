import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

export const GZIPPED_TRAIL_EXTENSION = ".trail.jsonl.gz";
export const GZIPPED_TRAIL_MAX_COMPRESSED_BYTES = 1_500_000;
export const GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES = 8_000_000;

export class TrailFileDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrailFileDecodeError";
  }
}

export function isGzippedTrailPath(path: string): boolean {
  return path.endsWith(GZIPPED_TRAIL_EXTENSION);
}

export function assertGzippedTrailCompressedSize(path: string, byteLength: number): void {
  if (byteLength <= GZIPPED_TRAIL_MAX_COMPRESSED_BYTES) return;
  throw new TrailFileDecodeError(
    `failed to decode gzip trail ${path}: compressed payload exceeds ${GZIPPED_TRAIL_MAX_COMPRESSED_BYTES} bytes`,
  );
}

export type DecodeGzippedTrailBytesOptions = {
  maxDecompressedBytes?: number;
};

export async function decodeGzippedTrailBytes(
  bytes: Uint8Array,
  path: string,
  options: DecodeGzippedTrailBytesOptions = {},
): Promise<string> {
  const maxDecompressedBytes = options.maxDecompressedBytes ?? GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES;
  assertGzippedTrailCompressedSize(path, bytes.byteLength);
  const compressed = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for await (const chunk of Readable.from([compressed]).pipe(gunzip)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxDecompressedBytes) {
        gunzip.destroy();
        throw new TrailFileDecodeError(
          `failed to decode gzip trail ${path}: decompressed payload exceeds ${maxDecompressedBytes} bytes`,
        );
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof TrailFileDecodeError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new TrailFileDecodeError(`failed to decode gzip trail ${path}: ${detail}`);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TrailFileDecodeError(`failed to decode gzip trail ${path}: invalid UTF-8`);
    }
    throw error;
  }
}
