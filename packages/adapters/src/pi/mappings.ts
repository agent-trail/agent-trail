import type { MappingDef } from "@agent-trail/adapter-kit";
import { branchMappings, branchStateMappings, branchVariantMappings } from "./mapping/branching.ts";
import { compactionMappings, compactionVariantMappings } from "./mapping/compaction.ts";
import { createPiMappingContext } from "./mapping/context.ts";
import { customMappings, customVariantMappings } from "./mapping/custom.ts";
import { messageMappings } from "./mapping/messages.ts";
import { metadataMappings } from "./mapping/metadata.ts";
import type { PiEnvelope } from "./source.ts";

export { PARENT_HINT, type ParentHint } from "./mapping/shared.ts";

/**
 * Build a mapping set bound to the session's source `version` string (e.g. "3").
 * v1 stamps `source.schema_version` from the session record's version on every
 * entry (message records carry no version of their own), so v2 must thread it
 * through the shared `sourceFor` helper to reproduce `source` byte-for-byte.
 */
export function makePiMappings(sessionVersion: string | undefined): MappingDef<PiEnvelope>[] {
  const ctx = createPiMappingContext(sessionVersion);

  return [
    ...messageMappings(ctx),
    ...customVariantMappings(ctx),
    ...branchVariantMappings(ctx),
    ...compactionVariantMappings(ctx),
    ...branchMappings(ctx),
    ...compactionMappings(ctx),
    ...metadataMappings(ctx),
    ...customMappings(ctx),
    ...branchStateMappings(ctx),
  ];
}
