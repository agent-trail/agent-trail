import { enforceSourceRawSize, redactValue } from "@agent-trail/core";
import type { Entry } from "@agent-trail/types";
import type { CcBlock, CcEnvelope } from "./source.ts";

export type BuiltEntry = {
  entry: Entry;
  parentUuid: string | null | undefined;
  localParentId?: string;
};

export type SourceForOptions = {
  synthesized?: boolean;
  envelopeRef?: string;
};

export function sourceFor(
  envelope: CcEnvelope,
  originalType: string | undefined,
  block?: CcBlock,
  blockIndex?: number,
  options?: SourceForOptions,
): NonNullable<Entry["source"]> {
  return {
    agent: "claude-code",
    ...(originalType !== undefined ? { original_type: originalType } : {}),
    ...(envelope.version !== undefined ? { schema_version: envelope.version } : {}),
    ...(options?.synthesized === true ? { synthesized: true } : {}),
    raw: buildRaw(envelope, block, blockIndex, options?.envelopeRef),
  };
}

function buildRaw(
  envelope: CcEnvelope,
  block: CcBlock | undefined,
  blockIndex: number | undefined,
  envelopeRef: string | undefined,
): Record<string, unknown> {
  if (envelopeRef !== undefined) {
    return {
      envelope_ref: envelopeRef,
      ...(block !== undefined ? { block: redactValue(block) as CcBlock } : {}),
      ...(blockIndex !== undefined ? { block_index: blockIndex } : {}),
    };
  }
  if (block === undefined) {
    return enforceSourceRawSize(redactValue(envelope) as Record<string, unknown>).value as Record<
      string,
      unknown
    >;
  }
  const inline = {
    envelope: redactValue(envelope) as CcEnvelope,
    block: redactValue(block) as CcBlock,
    block_index: blockIndex,
  };
  return enforceSourceRawSize(inline).value as Record<string, unknown>;
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
  options?: SourceForOptions,
) {
  if (envelope.timestamp === undefined) return undefined;
  return {
    id,
    ts: envelope.timestamp,
    source: sourceFor(envelope, originalType, block, blockIndex, options),
  };
}
