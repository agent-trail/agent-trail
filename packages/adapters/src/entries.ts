import { randomUUID } from "node:crypto";
import type { Entry } from "@agent-trail/types";
import { enforceSourceRawSize, redactValue } from "./source-raw.ts";

export type SourceForOptions = {
  synthesized?: boolean;
  envelopeRef?: string;
  schemaVersion?: string;
};

export type CreateSourceForConfig<Env> = {
  agent: string;
  resolveSchemaVersion: (envelope: Env, options?: SourceForOptions) => string | undefined;
};

export function createSourceFor<Env extends object, Block extends object>(
  config: CreateSourceForConfig<Env>,
): (
  envelope: Env,
  originalType: string | undefined,
  block?: Block,
  blockIndex?: number,
  options?: SourceForOptions,
) => NonNullable<Entry["source"]> {
  return (envelope, originalType, block, blockIndex, options) => {
    const schemaVersion = config.resolveSchemaVersion(envelope, options);
    return {
      agent: config.agent,
      ...(originalType !== undefined ? { original_type: originalType } : {}),
      ...(schemaVersion !== undefined ? { schema_version: schemaVersion } : {}),
      ...(options?.synthesized === true ? { synthesized: true } : {}),
      raw: buildRaw(envelope, block, blockIndex, options?.envelopeRef),
    };
  };
}

function buildRaw<Env extends object, Block extends object>(
  envelope: Env,
  block: Block | undefined,
  blockIndex: number | undefined,
  envelopeRef: string | undefined,
): Record<string, unknown> {
  if (envelopeRef !== undefined) {
    const raw = {
      envelope_ref: envelopeRef,
      ...(block !== undefined ? { block: redactValue(block) as Block } : {}),
      ...(blockIndex !== undefined ? { block_index: blockIndex } : {}),
    };
    return enforceSourceRawSize(raw).value as Record<string, unknown>;
  }
  if (block === undefined) {
    return enforceSourceRawSize(redactValue(envelope) as Record<string, unknown>).value as Record<
      string,
      unknown
    >;
  }
  const inline = {
    envelope: redactValue(envelope) as Env,
    block: redactValue(block) as Block,
    block_index: blockIndex,
  };
  return enforceSourceRawSize(inline).value as Record<string, unknown>;
}

export type CreateEntryIdConfig<Env> = {
  sourceId: (envelope: Env) => string | undefined;
  missingMessage: string;
  // Optional derivation strategy. When set, the returned id is
  // `deriveId(sourceId, suffix)` instead of the legacy `sourceId` /
  // `sourceId-suffix` composition. Adapters whose envelope ids do not match
  // the v0.1 `#/$defs/id` ULID/UUID pattern (e.g. Pi's 8-char hex shorts) use
  // this to mint deterministic v5 UUIDs while keeping the source id on
  // `source.raw` for traceability.
  deriveId?: (sourceId: string, suffix?: string) => string;
};

export function createEntryId<Env>(
  config: CreateEntryIdConfig<Env>,
): (envelope: Env, suffix?: string) => string {
  return (envelope, suffix) => {
    const id = config.sourceId(envelope);
    if (id === undefined) {
      throw new Error(config.missingMessage);
    }
    if (config.deriveId !== undefined) return config.deriveId(id, suffix);
    return suffix === undefined ? id : `${id}-${suffix}`;
  };
}

// Single-block envelopes preserve the (already-conformant) stable entry id as
// the trail event id. Multi-block envelopes mint a fresh id per block — by
// default a non-deterministic UUID, but callers can pass a `deriveBlockId`
// closure to produce deterministic ids (e.g. v5 from session_uid + source_id
// + block_index) so re-parses are idempotent. The source envelope id and
// per-block index live on `source.raw` for traceability.
export function pickBlockId(
  stableEntryId: string,
  totalBlocks: number,
  deriveBlockId?: (index: number) => string,
  index?: number,
): string {
  if (totalBlocks === 1) return stableEntryId;
  if (deriveBlockId !== undefined && index !== undefined) return deriveBlockId(index);
  return randomUUID();
}
