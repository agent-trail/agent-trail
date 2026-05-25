import { CREDENTIAL_PATTERNS, type RedactionPattern } from "./secret-patterns.ts";

export const SOURCE_RAW_HARD_CAP_BYTES = 32_768;
// Soft cap is one quarter of the hard cap. Tying them together keeps the
// "you're at 25% of the budget" warning useful regardless of how the hard
// cap is tuned downstream.
export const SOURCE_RAW_SOFT_CAP_BYTES = SOURCE_RAW_HARD_CAP_BYTES / 4;

export type EnforceSourceRawSizeOptions = {
  // Maximum bytes for the serialized source.raw. When exceeded, the writer
  // greedily replaces the largest string leaves with the elide marker until
  // the total byte count drops at or under the cap. If no leaves remain and
  // the value still exceeds the cap, falls back to a whole-value elide.
  // Pass null to disable both leaf-level and whole-value elision so the raw
  // envelope is preserved verbatim. Falls back to the
  // AGENT_TRAIL_SOURCE_RAW_HARD_CAP env var, then SOURCE_RAW_HARD_CAP_BYTES.
  hardCapBytes?: number | null;
};

export type EnforceSourceRawSizeResult = {
  value: unknown;
  elided: boolean;
  leavesTrimmed: number;
};

export function enforceSourceRawSize(
  value: unknown,
  options?: EnforceSourceRawSizeOptions,
): EnforceSourceRawSizeResult {
  const hardCap = resolveHardCap(options?.hardCapBytes);
  if (hardCap === null) {
    return { value, elided: false, leavesTrimmed: 0 };
  }

  const originalBytes = byteLengthOf(value);
  if (originalBytes <= hardCap) {
    return { value, elided: false, leavesTrimmed: 0 };
  }

  // Top-level string source.raw: nothing to recurse into, just elide the
  // whole value. Schema allows source.raw to be any JSON type; the if/then
  // constraint only fires when raw is an object.
  if (typeof value === "string") {
    return {
      value: { elided: true, size_bytes: originalBytes },
      elided: true,
      leavesTrimmed: 0,
    };
  }

  // Deep clone so we can mutate string leaves in place. Cheaper than
  // re-walking from the root after each trim, and the resulting structure
  // shares no references with the caller's input.
  const cloned = structuredClone(value);
  const leaves = collectStringLeaves(cloned);
  // Greedy minimum-necessary elision: biggest leaves first so we minimize
  // the count of trimmed leaves and preserve as much source-shape fidelity
  // as possible. Trimming a single large leaf usually saves more bytes than
  // trimming many small ones, so this converges in 1–2 mutations on
  // tool_result envelopes whose bulk lives in payload.output text.
  leaves.sort((a, b) => b.bytes - a.bytes);

  let trimmed = 0;
  for (const leaf of leaves) {
    const currentBytes = byteLengthOf(cloned);
    if (currentBytes <= hardCap) {
      break;
    }
    leaf.replace({ elided: true, size_bytes: leaf.bytes });
    trimmed += 1;
  }

  const finalBytes = byteLengthOf(cloned);
  if (finalBytes > hardCap) {
    // No leaves left (or non-string content dominates). Fall back to
    // whole-value elision; readers still get the original byte size and the
    // referencing envelope_ref entries continue to resolve.
    return {
      value: { elided: true, size_bytes: originalBytes },
      elided: true,
      leavesTrimmed: trimmed,
    };
  }

  return { value: cloned, elided: false, leavesTrimmed: trimmed };
}

function resolveHardCap(provided: number | null | undefined): number | null {
  if (provided !== undefined) {
    return provided;
  }
  const env = process.env.AGENT_TRAIL_SOURCE_RAW_HARD_CAP;
  if (env === "disabled" || env === "off" || env === "none") {
    return null;
  }
  if (env !== undefined && env !== "") {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return SOURCE_RAW_HARD_CAP_BYTES;
}

function byteLengthOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

type LeafHandle = {
  bytes: number;
  replace: (marker: { elided: true; size_bytes: number }) => void;
};

function collectStringLeaves(root: unknown): LeafHandle[] {
  const leaves: LeafHandle[] = [];
  walk(root);
  return leaves;

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const child = node[i];
        if (typeof child === "string") {
          const bytes = Buffer.byteLength(child, "utf8");
          leaves.push({
            bytes,
            replace(marker) {
              node[i] = marker;
            },
          });
        } else {
          walk(child);
        }
      }
      return;
    }
    if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        const child = obj[key];
        if (typeof child === "string") {
          const bytes = Buffer.byteLength(child, "utf8");
          leaves.push({
            bytes,
            replace(marker) {
              obj[key] = marker;
            },
          });
        } else {
          walk(child);
        }
      }
    }
  }
}

export function redactValue(
  value: unknown,
  patterns: readonly RedactionPattern[] = CREDENTIAL_PATTERNS,
): unknown {
  if (typeof value === "string") {
    return applyPatterns(value, patterns);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, patterns));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = redactValue((value as Record<string, unknown>)[key], patterns);
    }
    return out;
  }
  return value;
}

function applyPatterns(text: string, patterns: readonly RedactionPattern[]): string {
  let current = text;
  for (const pattern of patterns) {
    const regex = pattern.regex.flags.includes("g")
      ? new RegExp(pattern.regex.source, pattern.regex.flags)
      : new RegExp(pattern.regex.source, `${pattern.regex.flags}g`);
    current = current.replace(regex, pattern.placeholder);
  }
  return current;
}
