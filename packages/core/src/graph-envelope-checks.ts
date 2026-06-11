import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";
import type { SessionGroup } from "./session-groups.ts";

// Validates the optional envelope `sessions` manifest against the actual
// session groups in the file (spec §8.4, §9.6). The manifest, when present,
// must list one entry per group in file order. Manifest drift (wrong length,
// mismatched id or agent) is a warning so renderers can still display the
// file while flagging the inconsistency.
export function envelopeSessionsManifestWarnings(
  envelopeRecord: JsonlRecord,
  groups: SessionGroup[],
): Diagnostic[] {
  const sessions = (envelopeRecord.value as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];

  if (sessions.length !== groups.length) {
    diagnostics.push(
      createDiagnostic({
        line: envelopeRecord.line,
        path: "/sessions",
        severity: "warning",
        code: "envelope_sessions_manifest_drift",
        message: `envelope.sessions lists ${sessions.length} session(s); file contains ${groups.length}`,
      }),
    );
  }

  // Per-entry id/agent checks run on the prefix common to both arrays. Extra
  // manifest entries (or extra file groups) past the shared prefix are
  // silently truncated here — the length-mismatch warning above already
  // surfaces the problem at the file level, so renderers can still display
  // the file without a wall of per-entry drift warnings.
  const pairCount = Math.min(sessions.length, groups.length);
  for (let i = 0; i < pairCount; i += 1) {
    const declared = sessions[i];
    const group = groups[i] as SessionGroup;
    if (typeof declared !== "object" || declared === null) continue;
    const declaredId = (declared as { id?: unknown }).id;
    const declaredAgent = (declared as { agent?: unknown }).agent;
    const actualId = group.header.value.id;
    const actualAgentName =
      typeof group.header.value.agent === "object" && group.header.value.agent !== null
        ? (group.header.value.agent as { name?: unknown }).name
        : undefined;

    if (typeof declaredId === "string" && declaredId !== actualId) {
      diagnostics.push(
        createDiagnostic({
          line: envelopeRecord.line,
          path: `/sessions/${i}/id`,
          severity: "warning",
          code: "envelope_sessions_manifest_drift",
          message: `envelope.sessions[${i}].id "${declaredId}" does not match session header id "${actualId ?? "<unknown>"}"`,
        }),
      );
    }
    if (typeof declaredAgent === "string" && declaredAgent !== actualAgentName) {
      diagnostics.push(
        createDiagnostic({
          line: envelopeRecord.line,
          path: `/sessions/${i}/agent`,
          severity: "warning",
          code: "envelope_sessions_manifest_drift",
          message: `envelope.sessions[${i}].agent "${declaredAgent}" does not match session header agent.name "${typeof actualAgentName === "string" ? actualAgentName : "<unknown>"}"`,
        }),
      );
    }
  }

  return diagnostics;
}
