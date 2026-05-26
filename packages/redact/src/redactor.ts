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

// Event `type` values whose payloads are walked by an explicit branch above.
// Any other type falls into the generic walk so unknown / future / vendor
// events still get redacted.
const HANDLED_EVENT_TYPES = new Set<string>([
  "session",
  "agent_message",
  "user_message",
  "session_summary",
  "agent_thinking",
  "system_event",
  "user_interrupt",
  "branch_point",
  "context_compact",
  "branch_summary",
  "tool_call",
  "tool_result",
]);

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
      const headerSource = value.source as Record<string, unknown> | undefined;
      if (headerSource && typeof headerSource.path === "string") {
        yield keyVisit(headerSource, "path", `records[${index}].source.path`);
      }
    }

    if (type === "trail") {
      // Trail envelope carries vcs in the same shape as the session header.
      const vcs = value.vcs as Record<string, unknown> | undefined;
      if (vcs && typeof vcs.revision === "string") {
        yield keyVisit(vcs, "revision", `records[${index}].vcs.revision`);
      }
    }

    if (
      payload &&
      (type === "agent_message" ||
        type === "user_message" ||
        type === "session_summary" ||
        type === "agent_thinking" ||
        type === "system_event") &&
      typeof payload.text === "string"
    ) {
      yield keyVisit(payload, "text", `records[${index}].payload.text`);
    }

    if (payload && type === "user_interrupt" && typeof payload.reason === "string") {
      yield keyVisit(payload, "reason", `records[${index}].payload.reason`);
    }

    if (payload && type === "branch_point" && typeof payload.reason === "string") {
      yield keyVisit(payload, "reason", `records[${index}].payload.reason`);
    }

    if (
      payload &&
      (type === "context_compact" || type === "branch_summary") &&
      typeof payload.summary === "string"
    ) {
      yield keyVisit(payload, "summary", `records[${index}].payload.summary`);
    }

    if (payload && type === "user_message") {
      const attachments = payload.attachments;
      if (Array.isArray(attachments)) {
        for (let i = 0; i < attachments.length; i += 1) {
          const a = attachments[i] as Record<string, unknown> | undefined;
          if (a && typeof a.uri === "string") {
            yield keyVisit(a, "uri", `records[${index}].payload.attachments[${i}].uri`);
          }
        }
      }
    }

    if (payload && type === "system_event") {
      const data = payload.data;
      if (data !== null && typeof data === "object") {
        yield* walkContainer(
          data as Record<string, unknown> | unknown[],
          `records[${index}].payload.data`,
        );
      }
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

    // Forward-compat fallback: schema permits future event types whose
    // payloads are still arbitrary string-bearing objects. For any type not
    // already handled above, walk payload generically so unknown adapters
    // and vendor events do not bypass redaction.
    if (payload && typeof type === "string" && !HANDLED_EVENT_TYPES.has(type)) {
      yield* walkContainer(payload, `records[${index}].payload`);
    }

    const metadata = value.metadata;
    if (metadata !== null && typeof metadata === "object") {
      yield* walkContainer(
        metadata as Record<string, unknown> | unknown[],
        `records[${index}].metadata`,
      );
    }

    if (includeSourceRaw && type !== "session") {
      const source = value.source as Record<string, unknown> | undefined;
      const raw = source?.raw;
      if (raw !== undefined && raw !== null && typeof raw === "object") {
        yield* walkContainer(
          raw as Record<string, unknown> | unknown[],
          `records[${index}].source.raw`,
        );
      } else if (typeof raw === "string" && source) {
        yield keyVisit(source, "raw", `records[${index}].source.raw`);
      }
    }
  }
}

const SAMPLE_HEAD = 4;
const SAMPLE_TAIL = 4;
// Show head+tail only when both can be revealed without overlap and still
// elide at least one character from the middle. Otherwise, hide the entire
// match to avoid leaking short secrets verbatim in samples.
const SAMPLE_MIN_REVEAL = SAMPLE_HEAD + SAMPLE_TAIL + 1;

function maskSample(secret: string): string {
  if (secret.length === 0) return secret;
  if (secret.length < SAMPLE_MIN_REVEAL) return `<${secret.length} chars>`;
  return `${secret.slice(0, SAMPLE_HEAD)}…${secret.slice(-SAMPLE_TAIL)}`;
}

function ensureGlobal(regex: RegExp): RegExp {
  return regex.flags.includes("g") ? regex : new RegExp(regex.source, `${regex.flags}g`);
}

function applyPattern(
  visit: Visit,
  pattern: RedactionPattern,
  summary: RedactionSummary,
  maxSamples: number,
): void {
  const current = visit.get();
  const regex = ensureGlobal(pattern.regex);
  regex.lastIndex = 0;
  const matches = Array.from(current.matchAll(regex));
  if (matches.length === 0) return;
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
}

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Removes vcs.remote_url from the header. Default-on per spec §15 / PRD §8.6
// step 7 because the field reveals repository identity (potentially private).
// Records the strip in the summary so share-time previews surface it.
function stripVcsRemoteUrl(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "session" && value.type !== "trail") continue;
    const vcs = value.vcs as Record<string, unknown> | undefined;
    if (vcs === undefined || typeof vcs.remote_url !== "string") continue;
    const before = vcs.remote_url;
    delete vcs.remote_url;
    summary.counts.vcs_remote_url = (summary.counts.vcs_remote_url ?? 0) + 1;
    if (summary.samples.length < maxSamples) {
      summary.samples.push({
        patternId: "vcs_remote_url",
        location: `records[${index}].vcs.remote_url`,
        before: maskSample(before),
        after: "[STRIPPED]",
      });
    }
  }
}

function userSecretsPatterns(secrets: readonly string[]): RedactionPattern[] {
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

export function redactTrail(
  records: JsonlRecord[],
  options: RedactTrailOptions = {},
): RedactTrailResult {
  const basePatterns = options.patterns ?? DEFAULT_PATTERNS;
  const patterns = options.extendPatterns
    ? [...basePatterns, ...options.extendPatterns]
    : basePatterns;
  const userPatterns = userSecretsPatterns(options.userSecrets ?? []);
  const includeSourceRaw = options.includeSourceRaw ?? true;
  const outputMaxBytes = options.outputMaxBytes ?? 10_240;
  const maxSamples = options.maxSamples ?? 20;
  const keepRemoteUrl = options.keepRemoteUrl ?? false;
  const out = records.map((record) => structuredClone(record));
  const rawSummary: RedactionSummary = { counts: {}, samples: [] };

  if (!keepRemoteUrl) {
    stripVcsRemoteUrl(out, rawSummary, maxSamples);
  }

  for (const visit of visitStrings(out, includeSourceRaw)) {
    for (const pattern of userPatterns) {
      applyPattern(visit, pattern, rawSummary, maxSamples);
    }
    for (const pattern of patterns) {
      applyPattern(visit, pattern, rawSummary, maxSamples);
    }
    const current = visit.get();
    const pii = applyPii(current, visit.location, rawSummary, maxSamples);
    if (pii.text !== current) {
      visit.set(pii.text);
    }
    for (const sample of pii.samples) {
      if (rawSummary.samples.length >= maxSamples) break;
      rawSummary.samples.push(sample);
    }
  }

  truncateOutputs(out, outputMaxBytes, rawSummary, maxSamples);

  // Redacted bytes differ from the input artifact, so any finalized
  // content_hash carried on the input header is now stale. Reset to the
  // <pending> sentinel (spec §7.3) so strict verifiers do not flag the
  // mismatch and so share tooling recomputes the hash on the redacted
  // artifact before publishing. Skip the reset on a true no-op pass so
  // a finalized clean trail remains verifiable after this call.
  const changed = Object.keys(rawSummary.counts).length > 0;
  if (changed) {
    const head = out[0]?.value as Record<string, unknown> | undefined;
    if (head && head.type === "session" && typeof head.content_hash === "string") {
      head.content_hash = "<pending>";
    }
  }

  // Resynchronize JsonlRecord.raw with mutated value so downstream consumers
  // that log or persist `.raw` cannot leak unredacted source text.
  for (const record of out) {
    record.raw = JSON.stringify(record.value);
  }

  return { records: out, summary: rawSummary };
}
