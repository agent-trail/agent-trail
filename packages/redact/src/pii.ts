import { Redactor } from "@redactpii/node";
import type { RedactionSample, RedactionSummary } from "./types.ts";

const TOKEN_PATTERN = /\b(EMAIL|PHONE|SSN|CREDIT_CARD|NAME)_(\d+)\b/g;

const TOKEN_TO_PATTERN_ID: Record<string, string> = {
  EMAIL: "email_pii",
  PHONE: "phone_pii",
  SSN: "ssn_pii",
  CREDIT_CARD: "credit_card_pii",
  NAME: "name_pii",
};

const TOKEN_TO_PLACEHOLDER: Record<string, string> = {
  EMAIL: "[EMAIL]",
  PHONE: "[PHONE]",
  SSN: "[SSN]",
  CREDIT_CARD: "[CREDIT_CARD]",
  NAME: "[NAME]",
};

const PII_REDACTOR = new Redactor({
  anonymize: true,
  rules: { EMAIL: true, PHONE: true, SSN: true, CREDIT_CARD: true, NAME: true },
});

export type PiiResult = { text: string; samples: RedactionSample[] };

export function applyPii(text: string, location: string, summary: RedactionSummary): PiiResult {
  if (!text) return { text, samples: [] };
  const anonymized = PII_REDACTOR.redact(text);
  if (anonymized === text) return { text, samples: [] };

  const localSamples: RedactionSample[] = [];
  const seen = new Set<string>();
  let normalized = anonymized;
  for (const match of anonymized.matchAll(TOKEN_PATTERN)) {
    const kind = match[1] ?? "";
    const patternId = TOKEN_TO_PATTERN_ID[kind];
    if (!patternId) continue;
    summary.counts[patternId] = (summary.counts[patternId] ?? 0) + 1;
    if (!seen.has(kind)) {
      seen.add(kind);
      localSamples.push({
        patternId,
        location,
        before: "[REDACTED PII]",
        after: TOKEN_TO_PLACEHOLDER[kind] ?? "[PII]",
      });
    }
  }
  normalized = normalized.replace(TOKEN_PATTERN, (_full, kind: string) => {
    return TOKEN_TO_PLACEHOLDER[kind] ?? "[PII]";
  });

  return { text: normalized, samples: localSamples };
}
