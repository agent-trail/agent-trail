import type { Entry } from "@agent-trail/types";
import { createEntryId, createSourceFor, type SourceForOptions } from "../entries.ts";
import { decodeCappedBase64, sha256Ref } from "../inline-media.ts";
import { CLAUDE_CODE_ENTRY_ID_NAMESPACE, deriveSynthesizedEntryId } from "../session-uid.ts";
import type { CcBlock, CcEnvelope } from "./source.ts";

export type { SourceForOptions };

export type BuiltEntry = {
  entry: Entry;
  parentSourceId: string | null | undefined;
  localParentId?: string;
};

const sourceForRaw = createSourceFor<CcEnvelope, CcBlock>({
  agent: "claude-code",
  resolveSchemaVersion: (envelope) => envelope.version,
});

export function sourceFor(
  envelope: CcEnvelope,
  originalType: string | undefined,
  block?: CcBlock,
  blockIndex?: number,
  options?: SourceForOptions,
): NonNullable<Entry["source"]> {
  return sourceForRaw(
    sanitizeInlineMediaInRaw(envelope) as CcEnvelope,
    originalType,
    block !== undefined ? (sanitizeInlineMediaInRaw(block) as CcBlock) : undefined,
    blockIndex,
    options,
  );
}

function sanitizeInlineMediaInRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeInlineMediaInRaw);
  if (!isRecord(value)) return value;
  if (value.type === "image" || value.type === "document") {
    const source = isRecord(value.source) ? value.source : undefined;
    const data = typeof source?.data === "string" ? source.data : undefined;
    if (source?.type === "base64" && data !== undefined) {
      const decoded = decodeCappedBase64(data);
      const safeSource: Record<string, unknown> = { ...source };
      delete safeSource.data;
      if (decoded.bytes !== undefined) {
        safeSource.uri = sha256Ref(decoded.bytes);
      } else {
        safeSource.oversized = true;
      }
      return { ...value, source: safeSource };
    }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, sanitizeInlineMediaInRaw(child)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

// Per-parse context. Mirrors `PiEntryIdCtx`. Every emitted cc entry id is a
// deterministic v5 UUID seeded from (session_uid, source_uuid [, suffix]) so
// re-parses are idempotent per spec §9.5 and short-uuid source envelopes still
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
