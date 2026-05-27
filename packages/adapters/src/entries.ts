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
    return {
      envelope_ref: envelopeRef,
      ...(block !== undefined ? { block: redactValue(block) as Block } : {}),
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
    envelope: redactValue(envelope) as Env,
    block: redactValue(block) as Block,
    block_index: blockIndex,
  };
  return enforceSourceRawSize(inline).value as Record<string, unknown>;
}

export type CreateEntryIdConfig<Env> = {
  sourceId: (envelope: Env) => string | undefined;
  missingMessage: string;
};

export function createEntryId<Env>(
  config: CreateEntryIdConfig<Env>,
): (envelope: Env, suffix?: string) => string {
  return (envelope, suffix) => {
    const id = config.sourceId(envelope);
    if (id === undefined) {
      throw new Error(config.missingMessage);
    }
    return suffix === undefined ? id : `${id}-${suffix}`;
  };
}

// Single-block envelopes preserve the source uuid as the trail event id (1:1).
// Multi-block envelopes mint a fresh UUID per block so each event id stays a
// valid ULID/UUID per the v0.1 id regex. Source uuid and per-block index live
// on `source.raw` for traceability.
export function pickBlockId(stableEntryId: string, totalBlocks: number): string {
  return totalBlocks === 1 ? stableEntryId : crypto.randomUUID();
}
