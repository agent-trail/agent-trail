import type { Entry } from "@agent-trail/types";
import { createEntryId, createSourceFor, type SourceForOptions } from "../entries.ts";
import type { PiBlock, PiEnvelope } from "./source.ts";
import { timestampToIso, versionString } from "./source.ts";

export type { SourceForOptions };

export type BuiltEntry = {
  entry: Entry;
  parentSourceId: string | null | undefined;
  localParentId?: string;
};

export const sourceFor = createSourceFor<PiEnvelope, PiBlock>({
  agent: "pi",
  resolveSchemaVersion: (envelope, options) =>
    versionString(envelope.version) ?? options?.schemaVersion,
});

export const entryId = createEntryId<PiEnvelope>({
  sourceId: (envelope) => envelope.id,
  missingMessage: "Pi entry missing id",
});

// Per-event audit tag (`meta["dev.pi.raw_type"]`) recording which source variant produced
// the entry. Schema source metadata is closed (additionalProperties:false in schema.json), so the
// tag lives under reverse-DNS entry meta per spec §8.0.3 / §11.
export function stampRawType<T extends Entry>(entry: T, rawType: string): T {
  const existing = (entry.meta as Record<string, unknown> | undefined) ?? {};
  return { ...entry, meta: { ...existing, "dev.pi.raw_type": rawType } } as T;
}

export function baseEntry(
  envelope: PiEnvelope,
  id: string,
  originalType: string | undefined,
  block?: PiBlock,
  blockIndex?: number,
  options?: SourceForOptions,
) {
  const ts = timestampToIso(envelope.timestamp);
  if (ts === undefined) return undefined;
  return {
    id,
    ts,
    source: sourceFor(envelope, originalType, block, blockIndex, options),
  };
}
