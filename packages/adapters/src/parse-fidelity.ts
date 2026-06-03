import type { Entry, Header } from "@agent-trail/types";

type ParseFidelity = {
  quarantined_count: number;
  termination_reason?:
    | "eof_with_open_tool_calls"
    | "process_terminated"
    | "truncated"
    | "user_abort";
};

const UNKNOWN_RECORD_KIND = /^x-[a-z0-9]+(?:-[a-z0-9]+)*\/unknown_record$/;

export function applyParseFidelity(header: Header, entries: Entry[]): Header {
  const parseFidelity: ParseFidelity = {
    quarantined_count: entries.filter(isQuarantinedUnknownRecord).length,
  };
  const terminationReason = finalSessionTerminatedReason(entries);
  if (terminationReason !== undefined) parseFidelity.termination_reason = terminationReason;
  (header as Header & { parse_fidelity: ParseFidelity }).parse_fidelity = parseFidelity;
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
    if (
      rawReason === "eof_with_open_tool_calls" ||
      rawReason === "process_terminated" ||
      rawReason === "truncated" ||
      rawReason === "user_abort"
    ) {
      reason = rawReason;
    }
  }
  return reason;
}
