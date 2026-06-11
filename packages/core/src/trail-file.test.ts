import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import {
  assertGzippedTrailCompressedSize,
  decodeGzippedTrailBytes,
  GZIPPED_TRAIL_MAX_COMPRESSED_BYTES,
  GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES,
  isGzippedTrailPath,
  TrailFileDecodeError,
} from "./trail-file.ts";

test("decodeGzippedTrailBytes decodes whole-file gzip UTF-8 trail bytes", async () => {
  const source = '{"type":"session"}\n';
  const decoded = await decodeGzippedTrailBytes(
    gzipSync(Buffer.from(source, "utf8")),
    "ok.trail.jsonl.gz",
  );

  expect(decoded).toBe(source);
});

test("decodeGzippedTrailBytes reports invalid gzip bytes as a trail decode error", async () => {
  await expect(
    decodeGzippedTrailBytes(Buffer.from("not gzip"), "broken.trail.jsonl.gz"),
  ).rejects.toThrow(TrailFileDecodeError);
  await expect(
    decodeGzippedTrailBytes(Buffer.from("not gzip"), "broken.trail.jsonl.gz"),
  ).rejects.toThrow("failed to decode gzip trail broken.trail.jsonl.gz");
});

test("decodeGzippedTrailBytes reports invalid UTF-8 payloads as a trail decode error", async () => {
  const invalidUtf8 = gzipSync(Buffer.from([0xff]));

  await expect(decodeGzippedTrailBytes(invalidUtf8, "bad-utf8.trail.jsonl.gz")).rejects.toThrow(
    TrailFileDecodeError,
  );
  await expect(decodeGzippedTrailBytes(invalidUtf8, "bad-utf8.trail.jsonl.gz")).rejects.toThrow(
    "failed to decode gzip trail bad-utf8.trail.jsonl.gz: invalid UTF-8",
  );
});

test("decodeGzippedTrailBytes rejects payloads over the decompressed byte limit", async () => {
  const oversized = gzipSync(Buffer.from("a".repeat(GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES + 1)));

  await expect(decodeGzippedTrailBytes(oversized, "oversized.trail.jsonl.gz")).rejects.toThrow(
    `decompressed payload exceeds ${GZIPPED_TRAIL_MAX_DECOMPRESSED_BYTES} bytes`,
  );
});

test("gzip helpers reject payloads over the compressed byte limit", async () => {
  const oversized = Buffer.alloc(GZIPPED_TRAIL_MAX_COMPRESSED_BYTES + 1);

  expect(() =>
    assertGzippedTrailCompressedSize("oversized.trail.jsonl.gz", oversized.byteLength),
  ).toThrow(TrailFileDecodeError);
  await expect(decodeGzippedTrailBytes(oversized, "oversized.trail.jsonl.gz")).rejects.toThrow(
    `compressed payload exceeds ${GZIPPED_TRAIL_MAX_COMPRESSED_BYTES} bytes`,
  );
});

test("isGzippedTrailPath detects only the native compressed trail suffix", () => {
  expect(isGzippedTrailPath("session.trail.jsonl.gz")).toBe(true);
  expect(isGzippedTrailPath("session.trail.jsonl")).toBe(false);
  expect(isGzippedTrailPath("session.trail.jsonl.gz.b64")).toBe(false);
});
