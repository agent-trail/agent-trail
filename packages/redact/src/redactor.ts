import type { JsonlRecord } from "@agent-trail/core";
import { DEFAULT_PATTERNS } from "./patterns.ts";
import { applyPii } from "./pii.ts";
import { truncateOutputs } from "./truncate.ts";
import type {
  RedactionPattern,
  RedactionSummary,
  RedactTrailOptions,
  RedactTrailResult,
} from "./types.ts";

type Visit = {
  location: string;
  get: () => string;
  set: (next: string) => void;
};

function arrayVisit(container: unknown[], index: number, location: string): Visit {
  return {
    location,
    get: () => container[index] as string,
    set: (next) => {
      container[index] = next;
    },
  };
}

function keyVisit(container: Record<string, unknown>, key: string, location: string): Visit {
  return {
    location,
    get: () => container[key] as string,
    set: (next) => {
      container[key] = next;
    },
  };
}

function* walkContainer(
  container: Record<string, unknown> | unknown[],
  prefix: string,
): Generator<Visit> {
  if (Array.isArray(container)) {
    for (let i = 0; i < container.length; i += 1) {
      const child = container[i];
      const path = `${prefix}[${i}]`;
      if (typeof child === "string") {
        yield arrayVisit(container, i, path);
      } else if (child !== null && typeof child === "object") {
        yield* walkContainer(child as Record<string, unknown> | unknown[], path);
      }
    }
    return;
  }
  for (const key of Object.keys(container)) {
    const child = container[key];
    const path = `${prefix}.${key}`;
    if (typeof child === "string") {
      yield keyVisit(container, key, path);
    } else if (child !== null && typeof child === "object") {
      yield* walkContainer(child as Record<string, unknown> | unknown[], path);
    }
  }
}

function* visitStrings(records: JsonlRecord[], includeSourceRaw: boolean): Generator<Visit> {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    const payload = value.payload as Record<string, unknown> | undefined;
    const type = value.type;

    if (type === "session") {
      if (typeof value.cwd === "string") {
        yield keyVisit(value, "cwd", `records[${index}].cwd`);
      }
      const vcs = value.vcs as Record<string, unknown> | undefined;
      if (vcs && typeof vcs.revision === "string") {
        yield keyVisit(vcs, "revision", `records[${index}].vcs.revision`);
      }
    }

    if (
      payload &&
      (type === "agent_message" || type === "user_message" || type === "session_summary") &&
      typeof payload.text === "string"
    ) {
      yield keyVisit(payload, "text", `records[${index}].payload.text`);
    }

    if (payload && type === "tool_call") {
      const args = payload.args;
      if (args !== null && typeof args === "object") {
        yield* walkContainer(
          args as Record<string, unknown> | unknown[],
          `records[${index}].payload.args`,
        );
      }
    }

    if (payload && type === "tool_result") {
      if (typeof payload.output === "string") {
        yield keyVisit(payload, "output", `records[${index}].payload.output`);
      }
      if (typeof payload.error === "string") {
        yield keyVisit(payload, "error", `records[${index}].payload.error`);
      }
    }

    if (includeSourceRaw) {
      const source = value.source as Record<string, unknown> | undefined;
      const metadata = source?.metadata as Record<string, unknown> | undefined;
      const raw = metadata?.raw;
      if (raw !== undefined && raw !== null && typeof raw === "object") {
        yield* walkContainer(
          raw as Record<string, unknown> | unknown[],
          `records[${index}].source.metadata.raw`,
        );
      } else if (typeof raw === "string" && metadata) {
        yield keyVisit(metadata, "raw", `records[${index}].source.metadata.raw`);
      }
    }
  }
}

const SAMPLE_HEAD = 8;
const SAMPLE_TAIL = 8;

function maskSample(secret: string): string {
  if (secret.length <= SAMPLE_HEAD + SAMPLE_TAIL + 1) return secret;
  return `${secret.slice(0, SAMPLE_HEAD)}…${secret.slice(-SAMPLE_TAIL)}`;
}

function applyPattern(visit: Visit, pattern: RedactionPattern, summary: RedactionSummary): void {
  const current = visit.get();
  pattern.regex.lastIndex = 0;
  const matches = Array.from(current.matchAll(pattern.regex));
  if (matches.length === 0) return;
  pattern.regex.lastIndex = 0;
  visit.set(current.replace(pattern.regex, pattern.placeholder));
  summary.counts[pattern.id] = (summary.counts[pattern.id] ?? 0) + matches.length;
  const first = matches[0]?.[0] ?? "";
  summary.samples.push({
    patternId: pattern.id,
    location: visit.location,
    before: maskSample(first),
    after: pattern.placeholder,
  });
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function userSecretsPatterns(secrets: readonly string[]): RedactionPattern[] {
  const unique = Array.from(new Set(secrets.filter((s) => s.length > 0)));
  return unique.map(
    (literal): RedactionPattern => ({
      id: "user_secret",
      description: "User-supplied secret literal",
      regex: new RegExp(escapeRegex(literal), "g"),
      placeholder: "[USER_SECRET]",
    }),
  );
}

export function redactTrail(
  records: JsonlRecord[],
  options: RedactTrailOptions = {},
): RedactTrailResult {
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const userPatterns = userSecretsPatterns(options.userSecrets ?? []);
  const includeSourceRaw = options.includeSourceRaw ?? true;
  const outputMaxBytes = options.outputMaxBytes ?? 10_240;
  const maxSamples = options.maxSamples ?? 20;
  const out = records.map((record) => structuredClone(record));
  const rawSummary: RedactionSummary = { counts: {}, samples: [] };

  truncateOutputs(out, outputMaxBytes, rawSummary);

  for (const visit of visitStrings(out, includeSourceRaw)) {
    for (const pattern of userPatterns) {
      applyPattern(visit, pattern, rawSummary);
    }
    for (const pattern of patterns) {
      applyPattern(visit, pattern, rawSummary);
    }
    const current = visit.get();
    const pii = applyPii(current, visit.location, rawSummary);
    if (pii.text !== current) {
      visit.set(pii.text);
    }
    for (const sample of pii.samples) {
      rawSummary.samples.push(sample);
    }
  }

  const summary: RedactionSummary = {
    counts: rawSummary.counts,
    samples: rawSummary.samples.slice(0, Math.max(0, maxSamples)),
  };
  return { records: out, summary };
}
