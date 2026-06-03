import type { JsonlRecord } from "./jsonl.ts";

export type SessionTerminationReason =
  | "eof_with_open_tool_calls"
  | "process_terminated"
  | "truncated"
  | "user_abort";

// Keep in sync with packages/adapters/src/parse-fidelity.ts. This core helper
// works on parsed JsonlRecord values; the adapter helper works on typed Entry values.
const UNKNOWN_RECORD_KIND = /^x-[a-z0-9]+(?:-[a-z0-9]+)*\/unknown_record$/;
const SESSION_TERMINATION_REASONS = new Set<string>([
  "eof_with_open_tool_calls",
  "process_terminated",
  "truncated",
  "user_abort",
]);

export function parseFidelityForEvents(events: JsonlRecord[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    quarantined_count: events.filter(isQuarantinedUnknownRecord).length,
  };
  const terminationReason = finalSessionTerminatedReason(events);
  if (terminationReason !== undefined) out.termination_reason = terminationReason;
  return out;
}

export function isQuarantinedUnknownRecord(record: JsonlRecord): boolean {
  if (record.value.type !== "system_event") return false;
  const payload = record.value.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const kind = (payload as { kind?: unknown }).kind;
  return typeof kind === "string" && UNKNOWN_RECORD_KIND.test(kind);
}

export function finalSessionTerminatedReason(
  events: JsonlRecord[],
): SessionTerminationReason | undefined {
  let reason: SessionTerminationReason | undefined;
  for (const record of events) {
    if (record.value.type !== "session_terminated") continue;
    const payload = record.value.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
    const rawReason = (payload as { reason?: unknown }).reason;
    if (typeof rawReason === "string" && SESSION_TERMINATION_REASONS.has(rawReason)) {
      reason = rawReason as SessionTerminationReason;
    }
  }
  return reason;
}
