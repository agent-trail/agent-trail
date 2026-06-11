import { gunzipSync } from "node:zlib";

export const GZIPPED_TRAIL_EXTENSION = ".trail.jsonl.gz";

export class TrailFileDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrailFileDecodeError";
  }
}

export function isGzippedTrailPath(path: string): boolean {
  return path.endsWith(GZIPPED_TRAIL_EXTENSION);
}

export function decodeGzippedTrailBytes(bytes: Uint8Array, path: string): string {
  let decoded: Buffer;
  try {
    decoded = gunzipSync(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TrailFileDecodeError(`failed to decode gzip trail ${path}: ${detail}`);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new TrailFileDecodeError(`failed to decode gzip trail ${path}: invalid UTF-8`);
    }
    throw error;
  }
}
