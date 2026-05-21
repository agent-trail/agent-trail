import type { Entry } from "@agent-trail/types";
import type { PiBlock, PiEnvelope } from "./source.ts";
import { versionString } from "./source.ts";

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

export function baseEntry(
  envelope: PiEnvelope,
  id: string,
  originalType: string | undefined,
  block?: PiBlock,
  blockIndex?: number,
  options?: { synthesized?: boolean; schemaVersion?: string },
) {
  if (envelope.timestamp === undefined) return undefined;
  return {
    id,
    ts: envelope.timestamp,
    source: sourceFor(envelope, originalType, block, blockIndex, options),
  };
}
