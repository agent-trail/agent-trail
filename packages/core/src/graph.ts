import type { Diagnostic } from "./diagnostics.ts";
import {
  childSessionLinkWarnings,
  crossGroupForkFromWarnings,
  envelopeRefWarnings,
  finalMessageIdWarnings,
  nonMonotonicEventTsWarnings,
  outOfOrderSessionHeadersWarnings,
  parseFidelityConsistencyWarnings,
  streamConsistencyWarnings,
  unmatchedToolCallWarnings,
  userQueryResponseWarnings,
  vcsRevisionDivergenceWarnings,
} from "./graph-checks.ts";
import { contentHashDiagnostics } from "./graph-hash-checks.ts";
import { validateGraphPrologue } from "./graph-prologue.ts";
import { validateGraphTopology } from "./graph-topology.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { resolveValidationProfile, type ValidationProfile } from "./profile.ts";
import { type SessionGroup, splitSessionGroups } from "./session-groups.ts";

export type ValidateTrailGraphOptions = {
  canonicalBytesComplete?: boolean;
  profile?: ValidationProfile;
};

export function validateTrailGraph(
  records: JsonlRecord[],
  options: ValidateTrailGraphOptions = {},
): Diagnostic[] {
  const canonicalBytesComplete = options.canonicalBytesComplete ?? true;
  const profile = resolveValidationProfile(options.profile);
  const diagnostics: Diagnostic[] = [];

  const split = splitSessionGroups(records);
  const envelopeRecord = split.envelope ?? undefined;
  const prologue = validateGraphPrologue(records, split, profile);
  diagnostics.push(...prologue.diagnostics);
  const { headerValidByGroup } = prologue;

  const topology = validateGraphTopology(split.groups, envelopeRecord);
  diagnostics.push(...topology.diagnostics);

  // Per-group downstream checks. A group with an invalid header is skipped
  // individually — sibling groups with valid headers still get their checks.
  for (let i = 0; i < split.groups.length; i += 1) {
    if (!headerValidByGroup[i]) continue;
    const group = split.groups[i] as SessionGroup;
    const groupIdLines = topology.groupIdLines[i] as Map<string, number>;
    const groupCyclicIds = topology.groupCyclicIds[i] as Set<string>;
    diagnostics.push(...nonMonotonicEventTsWarnings(group.entries, groupIdLines, groupCyclicIds));
    diagnostics.push(...streamConsistencyWarnings(group.header, group.entries));
    diagnostics.push(...unmatchedToolCallWarnings(group.entries));
    const groupHeaderId =
      typeof group.header.value.id === "string" ? group.header.value.id : undefined;
    diagnostics.push(...finalMessageIdWarnings(group.entries, groupIdLines, groupHeaderId));
    diagnostics.push(...envelopeRefWarnings(group.entries, groupIdLines));
    diagnostics.push(...userQueryResponseWarnings(group.entries));
    diagnostics.push(...parseFidelityConsistencyWarnings(group.header, group.entries));
  }
  // File-scoped cross-group warnings compare among valid-header groups only.
  // A malformed header in one group does not silence comparisons among its
  // valid-header siblings.
  const validGroups = split.groups.filter((_, i) => headerValidByGroup[i]);
  if (validGroups.length > 1) {
    diagnostics.push(...outOfOrderSessionHeadersWarnings(validGroups));
    diagnostics.push(...vcsRevisionDivergenceWarnings(validGroups));
    diagnostics.push(...crossGroupForkFromWarnings(validGroups));
    diagnostics.push(...childSessionLinkWarnings(validGroups));
  }

  if (canonicalBytesComplete) {
    diagnostics.push(
      ...contentHashDiagnostics(records, split.groups, headerValidByGroup, envelopeRecord, profile),
    );
  }

  return diagnostics;
}
