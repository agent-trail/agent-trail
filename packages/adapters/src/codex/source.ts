// Codex rollout JSONL is a single wrapped format across every observed
// originator on disk (`codex-tui` 0.128.x — the interactive CLI, `Codex Desktop`
// 0.133.x-alpha, `codex_sdk_ts` 0.98.x). Every record is
// `{timestamp, type, payload}` and the first record is always
// `type:"session_meta"`. Top-level `type` values seen in real sessions:
// `session_meta`, `response_item`, `event_msg`, `turn_context`, `compacted`.
// Forward-compat: unknown top-level types are preserved verbatim under
// `source.raw`.
export type CodexRecord = {
  timestamp?: string;
  type: string;
  payload?: unknown;
  [k: string]: unknown;
};

// Strict numeric coercion is identical to the kit's coerceInt; re-export under
// the adapter-local name. isObject/stringValue are shared verbatim.
export { coerceInt as numericValue, isObject, stringValue } from "@agent-trail/adapter-kit";

export function parseLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) continue;
    try {
      out.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // Skip malformed lines defensively; recovery tracked as a follow-up.
    }
  }
  return out;
}

export function timestampToIso(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    try {
      return new Date(value).toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}
