import { type Adapter, defineAdapter, JsonlReader } from "@agent-trail/adapter-kit";
import type { Entry } from "@agent-trail/types";
import { PI_ENTRY_ID_NAMESPACE } from "../session-uid.ts";
import { makePiMappings } from "./mappings.ts";
import {
  piModelChangeFromModel,
  piParentResolution,
  piSessionTerminatedEof,
  piToolKindToResult,
} from "./reconcile-rules.ts";
import { type PiEnvelope, parseLines, timestampToIso, versionString } from "./source.ts";

/**
 * Build the kit-based Pi adapter for one parse, binding the session source
 * `version` into the mappings so `source.schema_version` matches the session
 * header (message records carry no version of their own — see makePiMappings).
 */
export function buildPiKitAdapter(sessionVersion: string | undefined): Adapter {
  return defineAdapter({
    agent: "pi",
    idNamespace: PI_ENTRY_ID_NAMESPACE,
    quarantineNamespace: "pi",
    sourceFormatVersions: ["v1"],
    reader: new JsonlReader({
      mode: "strict",
      versionFrom: (first) => versionString((first as PiEnvelope).version),
    }),
    tsFrom: (record) => timestampToIso((record as PiEnvelope).timestamp) ?? "",
    mappings: makePiMappings(sessionVersion),
    reconciler: {
      toolLinking: true,
      parentChain: false, // tree-native: piParentResolution sets parent_id
      cumulativeTokens: false, // usage passes through; cumulative is not computed
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

/** Source `version` of the session record, used to bind Pi's mappings. */
export function sessionVersionOf(text: string): string | undefined {
  return versionString(parseLines(text).find((env) => env.type === "session")?.version);
}

export async function parsePiSnapshotEntries(
  envelopes: PiEnvelope[],
  sessionUid: string,
): Promise<Entry[]> {
  const sessionVersion = versionString(envelopes.find((env) => env.type === "session")?.version);
  return buildPiKitAdapter(sessionVersion).parseSnapshot(
    { records: envelopes, sourceVersion: sessionVersion },
    { sessionUid },
  );
}

/** Run the kit-based Pi adapter over a source file, returning emitted entries. */
export async function parsePiEntries(path: string, sessionUid: string): Promise<Entry[]> {
  const text = await Bun.file(path).text();
  return parsePiSnapshotEntries(parseLines(text), sessionUid);
}
