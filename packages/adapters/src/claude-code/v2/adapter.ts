import { type Adapter, defineAdapter, JsonlReader } from "@agent-trail/adapter-kit";
import { CLAUDE_CODE_ENTRY_ID_NAMESPACE } from "../../session-uid.ts";
import { stringValue } from "../source.ts";
import { claudeCodeMappings } from "./mappings.ts";
import {
  ccEnvelopeRefBackfill,
  ccModelChangeSynth,
  ccPermissionModeDelta,
  ccToolKindToResult,
} from "./reconcile-rules.ts";

type Raw = Record<string, unknown>;

/**
 * Kit-based Claude Code adapter. Linear (built-in parentChain), per-record
 * source.schema_version (static mappings), agent == schema key "claude-code".
 * Synthesized model_change + permission-mode deltas + envelope_ref backfill are
 * custom rules (the assistant record is mapped, so an override would suppress it).
 */
export const claudeCodeV2Adapter: Adapter = defineAdapter({
  agent: "claude-code",
  idNamespace: CLAUDE_CODE_ENTRY_ID_NAMESPACE,
  quarantineNamespace: "claudecode",
  sourceFormatVersions: ["v1"],
  reader: new JsonlReader({ versionFrom: (first) => stringValue((first as Raw).version) }),
  tsFrom: (record) => stringValue((record as Raw).timestamp) ?? "",
  mappings: claudeCodeMappings,
  reconciler: {
    toolLinking: true,
    parentChain: true, // linear; v1 parentUuid chain doesn't fork
    cumulativeTokens: false,
    custom: [ccModelChangeSynth, ccToolKindToResult, ccPermissionModeDelta, ccEnvelopeRefBackfill],
  },
});
