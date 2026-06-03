import type { Entry, Header, ParseFidelity } from "@agent-trail/types";

// Keep in sync with packages/core/src/parse-fidelity.ts. This adapter helper
// works on typed Entry values; the core helper works on parsed JsonlRecord values.
const UNKNOWN_RECORD_KIND = /^x-[a-z0-9]+(?:-[a-z0-9]+)*\/unknown_record$/;
const SESSION_TERMINATION_REASONS = new Set<string>([
  "eof_with_open_tool_calls",
  "process_terminated",
  "truncated",
  "user_abort",
]);

export function applyParseFidelity(header: Header, entries: Entry[]): Header {
  const parseFidelity: ParseFidelity = {
    quarantined_count: entries.filter(isQuarantinedUnknownRecord).length,
  };
  const terminationReason = finalSessionTerminatedReason(entries);
  if (terminationReason !== undefined) parseFidelity.termination_reason = terminationReason;
  header.parse_fidelity = parseFidelity;
  return header;
}

function isQuarantinedUnknownRecord(entry: Entry): boolean {
  if (entry.type !== "system_event") return false;
  const kind = entry.payload.kind;
  return typeof kind === "string" && UNKNOWN_RECORD_KIND.test(kind);
}

function finalSessionTerminatedReason(entries: Entry[]): ParseFidelity["termination_reason"] {
  let reason: ParseFidelity["termination_reason"];
  for (const entry of entries) {
    if (entry.type !== "session_terminated") continue;
    const rawReason = entry.payload.reason;
    if (typeof rawReason === "string" && SESSION_TERMINATION_REASONS.has(rawReason)) {
      reason = rawReason as ParseFidelity["termination_reason"];
    }
  }
  return reason;
}
