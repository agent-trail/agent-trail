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

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) continue;
    try {
      out.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // Skip malformed lines defensively; PR2 hardening tracks recovery.
    }
  }
  return out;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
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
