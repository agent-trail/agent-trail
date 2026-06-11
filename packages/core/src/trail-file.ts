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
  return path.toLowerCase().endsWith(GZIPPED_TRAIL_EXTENSION);
}

export function assertGzippedTrailCompressedSize(path: string, byteLength: number): void {
  if (byteLength <= GZIPPED_TRAIL_MAX_COMPRESSED_BYTES) return;
  throw new TrailFileDecodeError(
    `failed to decode gzip trail ${path}: compressed payload exceeds ${GZIPPED_TRAIL_MAX_COMPRESSED_BYTES} bytes`,
  );
}

export type DecodeGzippedTrailBytesOptions = {
  maxCompressedBytes?: number;
  maxDecompressedBytes?: number;
};

export type DecodeGzippedTrailStreamOptions = DecodeGzippedTrailBytesOptions;

export async function* decodeGzippedTrailStream(
  input: AsyncIterable<Uint8Array<ArrayBufferLike>> | Iterable<Uint8Array<ArrayBufferLike>>,
  path: string,
  options: DecodeGzippedTrailStreamOptions = {},
): AsyncGenerator<Uint8Array<ArrayBufferLike>> {
  const maxCompressedBytes = options.maxCompressedBytes ?? GZIPPED_TRAIL_MAX_COMPRESSED_BYTES;
  const maxDecompressedBytes = options.maxDecompressedBytes ?? GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES;
  let compressedTotal = 0;
  let decompressedTotal = 0;
  const gunzip = createGunzip();

  async function* cappedInput(): AsyncGenerator<Uint8Array<ArrayBufferLike>> {
    for await (const chunk of input) {
      compressedTotal += chunk.byteLength;
      if (compressedTotal > maxCompressedBytes) {
        throw new TrailFileDecodeError(
          `failed to decode gzip trail ${path}: compressed payload exceeds ${maxCompressedBytes} bytes`,
        );
      }
      yield chunk;
    }
  }

  try {
    for await (const chunk of Readable.from(cappedInput()).pipe(gunzip)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      decompressedTotal += buffer.byteLength;
      if (decompressedTotal > maxDecompressedBytes) {
        gunzip.destroy();
        throw new TrailFileDecodeError(
          `failed to decode gzip trail ${path}: decompressed payload exceeds ${maxDecompressedBytes} bytes`,
        );
      }
      yield buffer;
    }
  } catch (error) {
    if (error instanceof TrailFileDecodeError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new TrailFileDecodeError(`failed to decode gzip trail ${path}: ${detail}`);
  }
}

export async function decodeGzippedTrailBytes(
  bytes: Uint8Array,
  path: string,
  options: DecodeGzippedTrailBytesOptions = {},
): Promise<string> {
  assertGzippedTrailCompressedSize(path, bytes.byteLength);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of decodeGzippedTrailStream([bytes], path, options)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    chunks.push(buffer);
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
