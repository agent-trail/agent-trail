import type { Entry } from "@agent-trail/types";
import type { PiBlock, PiEnvelope } from "./source.ts";
import { timestampToIso, versionString } from "./source.ts";

export type BuiltEntry = {
  entry: Entry;
  parentSourceId: string | null | undefined;
  localParentId?: string;
};

export function sourceFor(
  envelope: PiEnvelope,
  originalType: string | undefined,
  block?: PiBlock,
  blockIndex?: number,
  options?: { synthesized?: boolean; schemaVersion?: string },
): NonNullable<Entry["source"]> {
  const schemaVersion = versionString(envelope.version) ?? options?.schemaVersion;
  return {
    agent: "pi",
    ...(originalType !== undefined ? { original_type: originalType } : {}),
    ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
    ...(options?.synthesized === true ? { synthesized: true } : {}),
    raw:
      block === undefined
        ? (envelope as unknown as Record<string, unknown>)
        : {
            envelope,
            block,
            block_index: blockIndex,
          },
  };
}

export function entryId(envelope: PiEnvelope, suffix?: string): string {
  if (envelope.id === undefined) {
    throw new Error("Pi entry missing id");
  }
  return suffix === undefined ? envelope.id : `${envelope.id}-${suffix}`;
}

export function blockId(
  envelope: PiEnvelope,
  kind: string,
  index: number,
  totalBlocks: number,
): string {
  return totalBlocks === 1 ? entryId(envelope) : entryId(envelope, `${kind}-${index}`);
}

// Per-event audit tag (`metadata["dev.pi.raw_type"]`) recording which source variant produced
// the entry. Schema source metadata is closed (additionalProperties:false in schema.json), so the
// tag lives under reverse-DNS entry metadata per spec §11.
export function stampRawType<T extends Entry>(entry: T, rawType: string): T {
  const existing = (entry.metadata as Record<string, unknown> | undefined) ?? {};
  return { ...entry, metadata: { ...existing, "dev.pi.raw_type": rawType } } as T;
}

export function baseEntry(
  envelope: PiEnvelope,
  id: string,
  originalType: string | undefined,
  block?: PiBlock,
  blockIndex?: number,
  options?: { synthesized?: boolean; schemaVersion?: string },
) {
  const ts = timestampToIso(envelope.timestamp);
  if (ts === undefined) return undefined;
  return {
    id,
    ts,
    source: sourceFor(envelope, originalType, block, blockIndex, options),
  };
}
