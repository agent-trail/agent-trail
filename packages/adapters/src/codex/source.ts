export type CodexFormat = "legacy-cli" | "desktop-wrapped";

// Top-level shape of a desktop-wrapped Codex record. All payload-bearing records
// carry `{timestamp, type, payload}`. The recognised top-level `type` values are
// `session_meta`, `response_item`, `event_msg`, `turn_context`. Forward-compat:
// unknown top-level types are preserved verbatim under `source.raw`.
export type CodexDesktopRecord = {
  timestamp?: string;
  type: string;
  payload?: unknown;
  [k: string]: unknown;
};

// Top-level shape of a legacy CLI record. The session-header line is flat:
// `{id, timestamp, cwd, ...}` with no `type` field. Subsequent records carry an
// inline `type` field describing the event kind.
export type CodexLegacyRecord = {
  type?: string;
  id?: string;
  timestamp?: string | number;
  cwd?: string;
  [k: string]: unknown;
};

export type CodexRecord = CodexDesktopRecord | CodexLegacyRecord;

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

// Format dispatch (issue body §"Dual format dispatch"):
//   - first record has `type === "session_meta"`        → desktop-wrapped
//   - first record has `id` + `timestamp` and no `type` → legacy-cli
//   - else throw — unknown source shape
export function detectFormat(first: Record<string, unknown>): CodexFormat {
  if (first.type === "session_meta") return "desktop-wrapped";
  if (
    !("type" in first) &&
    typeof first.id === "string" &&
    (typeof first.timestamp === "string" || typeof first.timestamp === "number")
  ) {
    return "legacy-cli";
  }
  throw new Error(`Unrecognised Codex format: first record has type=${JSON.stringify(first.type)}`);
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
