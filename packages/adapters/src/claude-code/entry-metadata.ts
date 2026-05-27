import type { Entry } from "@agent-trail/types";
import { createEntryId, createSourceFor, type SourceForOptions } from "../entries.ts";
import type { CcBlock, CcEnvelope } from "./source.ts";

export type { SourceForOptions };

export type BuiltEntry = {
  entry: Entry;
  parentSourceId: string | null | undefined;
  localParentId?: string;
};

export const sourceFor = createSourceFor<CcEnvelope, CcBlock>({
  agent: "claude-code",
  resolveSchemaVersion: (envelope) => envelope.version,
});

export const entryId = createEntryId<CcEnvelope>({
  sourceId: (envelope) => envelope.uuid,
  missingMessage: "Claude Code entry missing uuid",
});

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
