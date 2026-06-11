import { Redactor } from "@redactpii/node";
import { assertSafeRegexSource } from "./regex-safety.ts";
import type { PiiConfig, RedactionSample, RedactionSummary } from "./types.ts";

const TOKEN_PATTERN = /\b(EMAIL|PHONE|SSN|CREDIT_CARD|NAME|PERSON)_(\d+)\b/g;
const PHONE_PATTERN =
  /(?<!\w)(?:\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|(?:1[-\s])?\(\d{3}\)\s?\d{3}[-.\s]?\d{4}|(?:1[-\s])?\d{3}[-\s]\d{3}[-\s]\d{4})\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const DEFAULT_EMAIL_ALLOWLIST = [
  "actions@github.com",
  "*@users.noreply.github.com",
  "*@noreply.github.com",
];

const TOKEN_TO_PATTERN_ID: Record<string, string> = {
  EMAIL: "email_pii",
  PHONE: "phone_pii",
  SSN: "ssn_pii",
  CREDIT_CARD: "credit_card_pii",
  NAME: "name_pii",
  PERSON: "name_pii",
};

const TOKEN_TO_PLACEHOLDER: Record<string, string> = {
  EMAIL: "[EMAIL]",
  PHONE: "[PHONE]",
  SSN: "[SSN]",
  CREDIT_CARD: "[CREDIT_CARD]",
  NAME: "[NAME]",
  PERSON: "[NAME]",
};

export type PiiResult = { text: string; samples: RedactionSample[]; count: number };

export function applyPii(
  text: string,
  location: string,
  summary: RedactionSummary,
  maxSamples: number,
  config: PiiConfig = {},
  allowedSecrets: ReadonlySet<string> = new Set(),
): PiiResult {
  if (!text) return { text, samples: [], count: 0 };
  const localSamples: RedactionSample[] = [];
  const protectedEmails =
    config.email === false
      ? { text, restore: (value: string) => value, count: 0 }
      : protectAllowlistedEmails(text, config.emailAllowlist ?? [], allowedSecrets);
  if (protectedEmails.count > 0) {
    summary.counts.allowlisted_skip =
      (summary.counts.allowlisted_skip ?? 0) + protectedEmails.count;
  }
  let current = protectedEmails.text;
  const custom = applyCustomLabels(
    current,
    location,
    summary,
    maxSamples,
    config.customLabels ?? {},
    allowedSecrets,
  );
  current = custom.text;
  localSamples.push(...custom.samples);
  let count = custom.count;
  if (config.phone ?? true) {
    const phone = applyPhone(current, location, summary, maxSamples, allowedSecrets);
    current = phone.text;
    count += phone.count;
    localSamples.push(...phone.samples);
  }
  const redactor = new Redactor({
    anonymize: true,
    rules: {
      EMAIL: config.email ?? true,
      PHONE: false,
      SSN: config.ssn ?? true,
      CREDIT_CARD: config.creditCard ?? true,
      NAME: config.name ?? true,
    },
  });
  const anonymized = redactor.redact(current);
  if (anonymized === current) {
    return { text: protectedEmails.restore(current), samples: localSamples, count };
  }

  const seenPatternIds = new Set<string>();
  for (const match of anonymized.matchAll(TOKEN_PATTERN)) {
    const kind = match[1] ?? "";
    const patternId = TOKEN_TO_PATTERN_ID[kind];
    if (!patternId) continue;
    count += 1;
    summary.counts[patternId] = (summary.counts[patternId] ?? 0) + 1;
    if (
      !seenPatternIds.has(patternId) &&
      summary.samples.length + localSamples.length < maxSamples
    ) {
      seenPatternIds.add(patternId);
      localSamples.push({
        patternId,
        location,
        before: `[${kind}]`,
        after: TOKEN_TO_PLACEHOLDER[kind] ?? "[PII]",
      });
    }
  }
  const normalized = anonymized.replace(TOKEN_PATTERN, (_full, kind: string) => {
    return TOKEN_TO_PLACEHOLDER[kind] ?? "[PII]";
  });

  return { text: protectedEmails.restore(normalized), samples: localSamples, count };
}

function applyCustomLabels(
  text: string,
  location: string,
  summary: RedactionSummary,
  maxSamples: number,
  customLabels: Record<string, string>,
  allowedSecrets: ReadonlySet<string>,
): PiiResult {
  let current = text;
  const samples: RedactionSample[] = [];
  let count = 0;
  for (const [label, source] of Object.entries(customLabels)) {
    assertSafeRegexSource(source, `custom label ${label}`);
    const id = `${label}_pii`;
    const placeholder = `[REDACTED_${label.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}]`;
    const regex = new RegExp(source, "g");
    regex.lastIndex = 0;
    const allMatches = Array.from(current.matchAll(regex));
    const matches = allMatches.filter((match) => !allowedSecrets.has(match[0] ?? ""));
    const skipped = allMatches.length - matches.length;
    if (skipped > 0) {
      summary.counts.allowlisted_skip = (summary.counts.allowlisted_skip ?? 0) + skipped;
    }
    if (matches.length === 0) continue;
    regex.lastIndex = 0;
    current = current.replace(regex, (match: string) =>
      allowedSecrets.has(match) ? match : placeholder,
    );
    count += matches.length;
    summary.counts[id] = (summary.counts[id] ?? 0) + matches.length;
    if (summary.samples.length + samples.length < maxSamples) {
      samples.push({
        patternId: id,
        location,
        before: `[${label.toUpperCase()}]`,
        after: placeholder,
      });
    }
  }
  return { text: current, samples, count };
}

function protectAllowlistedEmails(
  text: string,
  configuredAllowlist: string[],
  allowedSecrets: ReadonlySet<string>,
): { text: string; restore: (value: string) => string; count: number } {
  const allowlist = [...DEFAULT_EMAIL_ALLOWLIST, ...configuredAllowlist];
  const protectedValues: string[] = [];
  EMAIL_PATTERN.lastIndex = 0;
  const protectedText = text.replace(EMAIL_PATTERN, (email) => {
    if (!allowedSecrets.has(email) && !isEmailAllowlisted(email, allowlist)) return email;
    const token = `__AGENT_TRAIL_EMAIL_ALLOWLIST_${protectedValues.length}__`;
    protectedValues.push(email);
    return token;
  });
  return {
    text: protectedText,
    count: protectedValues.length,
    restore: (value: string) =>
      protectedValues.reduce(
        (current, email, index) =>
          current.replaceAll(`__AGENT_TRAIL_EMAIL_ALLOWLIST_${index}__`, email),
        value,
      ),
  };
}

function isEmailAllowlisted(email: string, allowlist: string[]): boolean {
  const lower = email.toLowerCase();
  for (const rawPattern of allowlist) {
    const pattern = rawPattern.toLowerCase();
    if (pattern.endsWith("@*") && lower.startsWith(pattern.slice(0, -1))) return true;
    if (pattern.startsWith("*@") && lower.endsWith(pattern.slice(1))) return true;
    if (pattern.endsWith("@") && lower.startsWith(pattern)) return true;
    if (pattern.startsWith("@") && lower.endsWith(pattern)) return true;
    if (lower === pattern) return true;
  }
  return false;
}

function applyPhone(
  text: string,
  location: string,
  summary: RedactionSummary,
  maxSamples: number,
  allowedSecrets: ReadonlySet<string>,
): PiiResult {
  PHONE_PATTERN.lastIndex = 0;
  const allMatches = Array.from(text.matchAll(PHONE_PATTERN));
  const matches = allMatches.filter((match) => !allowedSecrets.has(match[0] ?? ""));
  const skipped = allMatches.length - matches.length;
  if (skipped > 0) {
    summary.counts.allowlisted_skip = (summary.counts.allowlisted_skip ?? 0) + skipped;
  }
  if (matches.length === 0) return { text, samples: [], count: 0 };
  PHONE_PATTERN.lastIndex = 0;
  summary.counts.phone_pii = (summary.counts.phone_pii ?? 0) + matches.length;
  const samples: RedactionSample[] = [];
  if (summary.samples.length < maxSamples) {
    samples.push({
      patternId: "phone_pii",
      location,
      before: "[PHONE]",
      after: "[PHONE]",
    });
  }
  return {
    text: text.replace(PHONE_PATTERN, (match: string) =>
      allowedSecrets.has(match) ? match : "[PHONE]",
    ),
    samples,
    count: matches.length,
  };
}
