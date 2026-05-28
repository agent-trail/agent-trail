import type { Entry } from "@agent-trail/types";
import { createEntryId, createSourceFor, type SourceForOptions } from "../entries.ts";
import { deriveSynthesizedEntryId, PI_ENTRY_ID_NAMESPACE } from "../session-uid.ts";
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

// Per-parse context. Real Pi envelope ids are 8-char hex shorts that fail the
// v0.1 `#/$defs/id` regex, so every emitted entry id is a deterministic v5
// UUID seeded with the (header) session_uid + the source id. Determinism keeps
// re-parses idempotent (spec §8.5). Original source id stays under
// `source.raw.id` (via `buildRaw`).
export type PiEntryIdCtx = {
  entryId: (envelope: PiEnvelope, suffix?: string) => string;
  deriveBlockId: (sourceId: string, blockIndex: number) => string;
  deriveSynthesizedId: (parts: readonly string[]) => string;
};

export function makePiEntryIdCtx(sessionUid: string): PiEntryIdCtx {
  return {
    entryId: createEntryId<PiEnvelope>({
      sourceId: (envelope) => envelope.id,
      missingMessage: "Pi entry missing id",
      deriveId: (sourceId, suffix) =>
        deriveSynthesizedEntryId(
          PI_ENTRY_ID_NAMESPACE,
          suffix === undefined ? [sessionUid, sourceId] : [sessionUid, sourceId, suffix],
        ),
    }),
    deriveBlockId: (sourceId, blockIndex) =>
      deriveSynthesizedEntryId(PI_ENTRY_ID_NAMESPACE, [sessionUid, sourceId, String(blockIndex)]),
    deriveSynthesizedId: (parts) => deriveSynthesizedEntryId(PI_ENTRY_ID_NAMESPACE, parts),
  };
}

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
