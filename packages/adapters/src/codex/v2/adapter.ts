import { type Adapter, defineAdapter, JsonlReader } from "@agent-trail/adapter-kit";
import { CODEX_ENTRY_ID_NAMESPACE } from "../../session-uid.ts";
import { stringValue, timestampToIso } from "../source.ts";
import { codexMappings } from "./mappings.ts";
import { type CodexState, codexOverrides, initialCodexState } from "./overrides.ts";
import { codexTokenRollup } from "./reconcile-rules.ts";

type Raw = Record<string, unknown>;

function cliVersionOf(first: Raw): string | undefined {
  const payload =
    typeof first.payload === "object" && first.payload !== null ? (first.payload as Raw) : {};
  return stringValue(payload.cli_version) ?? stringValue(payload.originator);
}

/**
 * Kit-based Codex adapter. Linear (parentChain handles topology), explicit
 * call_ids (toolLinking), no per-entry source.schema_version → mappings are
 * static (no per-parse factory). The two synthesis behaviors live in overrides
 * (model_change, reasoning dedup); token_count→usage rollup is a custom rule.
 * `schemaAgent: "codex"` resolves the `codex/v0.128` schema while the emitted
 * source agent stays "codex-cli".
 */
export const codexV2Adapter: Adapter = defineAdapter<CodexState>({
  agent: "codex-cli",
  schemaAgent: "codex",
  idNamespace: CODEX_ENTRY_ID_NAMESPACE,
  quarantineNamespace: "codex",
  sourceFormatVersions: ["v0.128"],
  reader: new JsonlReader({ versionFrom: (first) => cliVersionOf(first as Raw) }),
  tsFrom: (record) => timestampToIso((record as Raw).timestamp) ?? "",
  mappings: codexMappings,
  overrides: codexOverrides,
  initialState: initialCodexState,
  reconciler: {
    toolLinking: true,
    parentChain: false, // v1 Codex is linear and emits no parent_id
    cumulativeTokens: false, // usage carries native cumulative via token_count rollup
    custom: [codexTokenRollup],
  },
});
