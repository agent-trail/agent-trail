import type { Entry } from "@agent-trail/types";
import { createEntryId, createSourceFor, type SourceForOptions } from "../entries.ts";
import { CLAUDE_CODE_ENTRY_ID_NAMESPACE, deriveSynthesizedEntryId } from "../session-uid.ts";
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

// Per-parse context. Mirrors `PiEntryIdCtx`. Every emitted cc entry id is a
// deterministic v5 UUID seeded from (session_uid, source_uuid [, suffix]) so
// re-parses are idempotent per spec §8.5 and short-uuid source envelopes still
// satisfy the v0.1 `#/$defs/id` regex. Original source uuid stays under
// `source.raw.uuid` via `buildRaw`.
//
// `deriveSynthesizedId` prepends `sessionUid` inside the helper (per PR #136
// review feedback) so callers can't forget the prefix and silently alias ids
// across sessions.
export type CcEntryIdCtx = {
  entryId: (envelope: CcEnvelope, suffix?: string) => string;
  deriveBlockId: (sourceId: string, blockIndex: number) => string;
  deriveSynthesizedId: (parts: readonly string[]) => string;
};

export function makeCcEntryIdCtx(sessionUid: string): CcEntryIdCtx {
  return {
    entryId: createEntryId<CcEnvelope>({
      sourceId: (envelope) => envelope.uuid,
      missingMessage: "Claude Code entry missing uuid",
      deriveId: (sourceId, suffix) =>
        deriveSynthesizedEntryId(
          CLAUDE_CODE_ENTRY_ID_NAMESPACE,
          suffix === undefined ? [sessionUid, sourceId] : [sessionUid, sourceId, suffix],
        ),
    }),
    deriveBlockId: (sourceId, blockIndex) =>
      deriveSynthesizedEntryId(CLAUDE_CODE_ENTRY_ID_NAMESPACE, [
        sessionUid,
        sourceId,
        String(blockIndex),
      ]),
    deriveSynthesizedId: (parts) =>
      deriveSynthesizedEntryId(CLAUDE_CODE_ENTRY_ID_NAMESPACE, [sessionUid, ...parts]),
  };
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
