import { applyEntropyRedaction } from "./entropy.ts";
import { applyPii } from "./pii.ts";
import type { RedactionPattern, RedactionSummary } from "./types.ts";
import { keyVisit, type Visit } from "./visits.ts";

const SAMPLE_HEAD = 4;
const SAMPLE_TAIL = 4;
const TEXT_ENCODER = new TextEncoder();
// Show head+tail only when both can be revealed without overlap and still
// elide at least one character from the middle. Otherwise, hide the entire
// match to avoid leaking short secrets verbatim in samples.
const SAMPLE_MIN_REVEAL = SAMPLE_HEAD + SAMPLE_TAIL + 1;

export function byteLength(s: string): number {
  return TEXT_ENCODER.encode(s).byteLength;
}

export function maskSample(secret: string): string {
  if (secret.length === 0) return secret;
  if (secret.length < SAMPLE_MIN_REVEAL) return `<${secret.length} chars>`;
  return `${secret.slice(0, SAMPLE_HEAD)}…${secret.slice(-SAMPLE_TAIL)}`;
}

function ensureGlobal(regex: RegExp): RegExp {
  return regex.flags.includes("g") ? regex : new RegExp(regex.source, `${regex.flags}g`);
}

export function applyPattern(
  visit: Visit,
  pattern: RedactionPattern,
  summary: RedactionSummary,
  maxSamples: number,
): number {
  const current = visit.get();
  const regex = ensureGlobal(pattern.regex);
  regex.lastIndex = 0;
  const matches = Array.from(current.matchAll(regex));
  if (matches.length === 0) return 0;
  regex.lastIndex = 0;
  visit.set(current.replace(regex, pattern.placeholder));
  summary.counts[pattern.id] = (summary.counts[pattern.id] ?? 0) + matches.length;
  if (summary.samples.length < maxSamples) {
    const first = matches[0]?.[0] ?? "";
    summary.samples.push({
      patternId: pattern.id,
      location: visit.location,
      before: maskSample(first),
      after: pattern.placeholder,
    });
  }
  return matches.length;
}

function redactVisit(
  visit: Visit,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction: boolean,
): void {
  for (const pattern of userPatterns) {
    applyPattern(visit, pattern, summary, maxSamples);
  }
  for (const pattern of patterns) {
    applyPattern(visit, pattern, summary, maxSamples);
  }
  if (enableEntropyRedaction) {
    applyEntropyRedaction(visit, summary, maxSamples);
  }
  const current = visit.get();
  const pii = applyPii(current, visit.location, summary, maxSamples);
  if (pii.text !== current) {
    visit.set(pii.text);
  }
  for (const sample of pii.samples) {
    if (summary.samples.length >= maxSamples) break;
    summary.samples.push(sample);
  }
}

export function redactString(
  value: string,
  location: string,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction = false,
): string {
  const container: Record<string, unknown> = { value };
  redactVisit(
    keyVisit(container, "value", -1, location),
    userPatterns,
    patterns,
    summary,
    maxSamples,
    enableEntropyRedaction,
  );
  return container.value as string;
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function userSecretsPatterns(secrets: readonly string[]): RedactionPattern[] {
  // Note: if a user-supplied secret happens to equal a placeholder
  // ("[OPENAI_KEY]", "<home>", etc.) repeated redaction passes can shorten
  // already-redacted output. Callers should pass raw secrets only.
  // Sorting by length descending prevents shorter overlapping secrets from
  // consuming bytes that a longer secret would have matched in full.
  const unique = Array.from(new Set(secrets.filter((s) => s.length > 0))).sort(
    (a, b) => b.length - a.length,
  );
  return unique.map(
    (literal): RedactionPattern => ({
      id: "user_secret",
      description: "User-supplied secret literal",
      regex: new RegExp(escapeRegex(literal), "g"),
      placeholder: "[USER_SECRET]",
    }),
  );
}
