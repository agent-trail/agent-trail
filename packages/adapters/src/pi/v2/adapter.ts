import { type Adapter, defineAdapter, JsonlReader } from "@agent-trail/adapter-kit";
import { PI_ENTRY_ID_NAMESPACE } from "../../session-uid.ts";
import { type PiEnvelope, timestampToIso, versionString } from "../source.ts";
import { makePiMappings } from "./mappings.ts";
import {
  piModelChangeFromModel,
  piParentResolution,
  piSessionTerminatedEof,
  piToolKindToResult,
} from "./reconcile-rules.ts";

/**
 * Build the kit-based Pi adapter for one parse, binding the session source
 * `version` into the mappings so `source.schema_version` matches v1 (message
 * records carry no version of their own — see makePiMappings).
 */
export function buildPiV2Adapter(sessionVersion: string | undefined): Adapter {
  return defineAdapter({
    agent: "pi",
    idNamespace: PI_ENTRY_ID_NAMESPACE,
    quarantineNamespace: "pi",
    sourceFormatVersions: ["v1"],
    reader: new JsonlReader({
      versionFrom: (first) => versionString((first as PiEnvelope).version),
    }),
    tsFrom: (record) => timestampToIso((record as PiEnvelope).timestamp) ?? "",
    mappings: makePiMappings(sessionVersion),
    reconciler: {
      toolLinking: true,
      parentChain: false, // tree-native: piParentResolution sets parent_id
      cumulativeTokens: false, // v1 passes usage through; does not compute cumulative
      custom: [
        // piModelChangeFromModel first: it reads the assistant model off the
        // parenting hint that piParentResolution strips.
        piModelChangeFromModel,
        piToolKindToResult,
        piParentResolution,
        piSessionTerminatedEof,
      ],
    },
  });
}
