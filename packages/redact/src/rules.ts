import { applyEntropyRedaction } from "./entropy.ts";
import { applyPii } from "./pii.ts";
import type { PiiConfig, RedactionPattern, RedactionSummary } from "./types.ts";
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
  allowedSecrets: ReadonlySet<string> = new Set(),
): number {
  const current = visit.get();
  const regex = ensureGlobal(pattern.regex);
  regex.lastIndex = 0;
  const allMatches = Array.from(current.matchAll(regex));
  const matches = allMatches.filter((match) => !allowedSecrets.has(match[0] ?? ""));
  const skipped = allMatches.length - matches.length;
  if (matches.length === 0) {
    if (skipped > 0) {
      summary.counts.allowlisted_skip = (summary.counts.allowlisted_skip ?? 0) + skipped;
    }
    return 0;
  }
  regex.lastIndex = 0;
  visit.set(
    current.replace(regex, (match: string, ...args: unknown[]) => {
      if (allowedSecrets.has(match)) return match;
      return expandReplacement(pattern.placeholder, match, args);
    }),
  );
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
  if (skipped > 0) {
    summary.counts.allowlisted_skip = (summary.counts.allowlisted_skip ?? 0) + skipped;
  }
  return matches.length;
}

function expandReplacement(placeholder: string, match: string, args: unknown[]): string {
  const offset = args.find((arg): arg is number => typeof arg === "number") ?? 0;
  const input = args.find((arg): arg is string => typeof arg === "string") ?? "";
  const offsetIndex = args.findIndex((arg) => typeof arg === "number");
  const captures = offsetIndex === -1 ? [] : args.slice(0, offsetIndex);
  return placeholder.replace(/\$(\$|&|`|'|\d{1,2})/g, (_token, name: string) => {
    if (name === "$") return "$";
    if (name === "&") return match;
    if (name === "`") return input.slice(0, offset);
    if (name === "'") return input.slice(offset + match.length);
    const index = Number.parseInt(name, 10);
    const capture = captures[index - 1];
    return typeof capture === "string" ? capture : "";
  });
}

export function allowedSecretSet(allowedSecrets: readonly string[]): Set<string> {
  return new Set(allowedSecrets.filter((secret) => secret.length > 0));
}

function redactVisit(
  visit: Visit,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction: boolean,
  pii: PiiConfig,
): void {
  const allowed = allowedSecretSet(allowedSecrets);
  const before = visit.get();
  if (allowed.has(before)) {
    summary.counts.allowlisted_skip = (summary.counts.allowlisted_skip ?? 0) + 1;
    return;
  }
  for (const pattern of userPatterns) {
    applyPattern(visit, pattern, summary, maxSamples, allowed);
  }
  for (const pattern of patterns) {
    applyPattern(visit, pattern, summary, maxSamples, allowed);
  }
  if (enableEntropyRedaction) {
    applyEntropyRedaction(visit, summary, maxSamples, allowed);
  }
  const current = visit.get();
  const piiResult = applyPii(current, visit.location, summary, maxSamples, pii, allowed);
  if (piiResult.text !== current) {
    visit.set(piiResult.text);
  }
  for (const sample of piiResult.samples) {
    if (summary.samples.length >= maxSamples) break;
    summary.samples.push(sample);
  }
}

export function redactString(
  value: string,
  location: string,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  allowedSecrets: readonly string[],
  summary: RedactionSummary,
  maxSamples: number,
  enableEntropyRedaction = false,
  pii: PiiConfig = {},
): string {
  const container: Record<string, unknown> = { value };
  redactVisit(
    keyVisit(container, "value", -1, location),
    userPatterns,
    patterns,
    allowedSecrets,
    summary,
    maxSamples,
    enableEntropyRedaction,
    pii,
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
