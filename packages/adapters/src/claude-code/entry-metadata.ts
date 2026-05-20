import type { Entry } from "@agent-trail/types";
import type { CcBlock, CcEnvelope } from "./source.ts";

export type BuiltEntry = {
  entry: Entry;
  parentUuid: string | null | undefined;
  localParentId?: string;
};

export function sourceFor(
  envelope: CcEnvelope,
  originalType: string | undefined,
  block?: CcBlock,
  blockIndex?: number,
  options?: { synthesized?: boolean },
): NonNullable<Entry["source"]> {
  return {
    agent: "claude-code",
    ...(originalType !== undefined ? { original_type: originalType } : {}),
    ...(envelope.version !== undefined ? { schema_version: envelope.version } : {}),
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

export function entryId(envelope: CcEnvelope, suffix?: string): string {
  if (envelope.uuid === undefined) {
    throw new Error("Claude Code entry missing uuid");
  }
  return suffix === undefined ? envelope.uuid : `${envelope.uuid}-${suffix}`;
}

export function blockId(
  envelope: CcEnvelope,
  kind: string,
  index: number,
  totalBlocks: number,
): string {
  return totalBlocks === 1 ? entryId(envelope) : entryId(envelope, `${kind}-${index}`);
}

export function baseEntry(
  envelope: CcEnvelope,
  id: string,
  originalType: string | undefined,
  block?: CcBlock,
  blockIndex?: number,
  options?: { synthesized?: boolean },
) {
  if (envelope.timestamp === undefined) return undefined;
  return {
    id,
    ts: envelope.timestamp,
    source: sourceFor(envelope, originalType, block, blockIndex, options),
  };
}
