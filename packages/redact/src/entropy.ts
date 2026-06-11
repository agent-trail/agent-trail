import { maskSample } from "./rules.ts";
import type { RedactionSummary } from "./types.ts";
import type { Visit } from "./visits.ts";

const MIN_TOKEN_LENGTH = 20;
const ENTROPY_THRESHOLD = 4.5;
const TOKEN_PATTERN = /[A-Za-z0-9._~+/=-]{20,}/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const PLACEHOLDER_PATTERN = /^\[[A-Z0-9_]+\]$/;

export function applyEntropyRedaction(
  visit: Visit,
  summary: RedactionSummary,
  maxSamples: number,
): number {
  const current = visit.get();
  TOKEN_PATTERN.lastIndex = 0;
  const matches = Array.from(current.matchAll(TOKEN_PATTERN)).filter((match) =>
    isHighEntropyCandidate(current, match),
  );
  if (matches.length === 0) return 0;

  TOKEN_PATTERN.lastIndex = 0;
  visit.set(
    current.replace(TOKEN_PATTERN, (candidate, offset: number) =>
      isHighEntropyCandidate(current, { 0: candidate, index: offset } as RegExpMatchArray)
        ? "[HIGH_ENTROPY_SECRET]"
        : candidate,
    ),
  );
  summary.counts.high_entropy_token = (summary.counts.high_entropy_token ?? 0) + matches.length;
  if (summary.samples.length < maxSamples) {
    summary.samples.push({
      patternId: "high_entropy_token",
      location: visit.location,
      before: maskSample(matches[0]?.[0] ?? ""),
      after: "[HIGH_ENTROPY_SECRET]",
    });
  }
  return matches.length;
}

function isHighEntropyCandidate(text: string, match: RegExpMatchArray): boolean {
  const candidate = match[0] ?? "";
  if (candidate.length < MIN_TOKEN_LENGTH) return false;
  if (PLACEHOLDER_PATTERN.test(candidate)) return false;
  if (UUID_PATTERN.test(candidate) || SHA256_HEX_PATTERN.test(candidate)) return false;
  const index = match.index ?? -1;
  if (index >= "sha256:".length && text.slice(index - "sha256:".length, index) === "sha256:") {
    return false;
  }
  return shannonEntropy(candidate) >= ENTROPY_THRESHOLD;
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}
