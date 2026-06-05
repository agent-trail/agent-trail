import { sourceFor } from "../entry-metadata.ts";
import { type PiBlock, type PiEnvelope, timestampToIso } from "../source.ts";

export interface PiMappingContext {
  emittableTs(record: PiEnvelope): string | null;
  src(
    record: PiEnvelope,
    originalType: string | undefined,
    block?: PiBlock,
    blockIndex?: number,
    options?: { synthesized?: boolean; envelopeRef?: string },
  ): ReturnType<typeof sourceFor>;
}

export function createPiMappingContext(sessionVersion: string | undefined): PiMappingContext {
  return {
    // Guard mirroring v1 `buildEntries` (id/timestamp gate) + `baseEntry` (drop
    // on unparseable ts). Returns the ISO ts when the record is emittable.
    emittableTs: (record) => {
      if (record.id === undefined) return null;
      return timestampToIso(record.timestamp) ?? null;
    },
    src: (record, originalType, block, blockIndex, options) =>
      sourceFor(record, originalType, block, blockIndex, {
        schemaVersion: sessionVersion,
        ...options,
      }),
  };
}
