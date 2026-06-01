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
  "user_query",
  "user_query_response",
  "capability_change",
]);

// Attachment references (image/file uris) appear on user_message, agent_message,
// and tool_result payloads (spec §9.2). They carry potentially sensitive uris
// (local file: paths leaking home/username, https: with tokens), so scrub them
// the same way wherever they appear.
function* visitAttachments(payload: Record<string, unknown>, index: number): Generator<Visit> {
  const attachments = payload.attachments;
  if (!Array.isArray(attachments)) return;
  for (let i = 0; i < attachments.length; i += 1) {
    const a = attachments[i];
    if (a === null || typeof a !== "object") continue;
    const obj = a as Record<string, unknown>;
    if (typeof obj.uri === "string") {
      yield keyVisit(obj, "uri", `records[${index}].payload.attachments[${i}].uri`);
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

    if (payload && (type === "user_message" || type === "agent_message")) {
      yield* visitAttachments(payload, index);
    }

    if (payload && (type === "user_query" || type === "user_query_response")) {
      yield* walkContainer(payload, `records[${index}].payload`);
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
      yield* visitAttachments(payload, index);
      const resultMeta = payload.meta;
      if (resultMeta !== null && typeof resultMeta === "object") {
        yield* walkContainer(
          resultMeta as Record<string, unknown> | unknown[],
          `records[${index}].payload.meta`,
        );
      }
    }

    if (payload && type === "capability_change") {
      yield* walkContainer(payload, `records[${index}].payload`);
    }

    // Forward-compat fallback: schema permits future event types whose
    // payloads are still arbitrary string-bearing objects. For any type not
    // already handled above, walk payload generically so unknown adapters
    // and vendor events do not bypass redaction.
    if (payload && typeof type === "string" && !HANDLED_EVENT_TYPES.has(type)) {
      yield* walkContainer(payload, `records[${index}].payload`);
    }

    const meta = value.meta;
    if (meta !== null && typeof meta === "object") {
      yield* walkContainer(meta as Record<string, unknown> | unknown[], `records[${index}].meta`);
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

function secretQuestionIdsByQueryId(records: JsonlRecord[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const record of records) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query") continue;
    const entryId = value.id;
    const payload = value.payload as { questions?: unknown } | undefined;
    if (typeof entryId !== "string" || !Array.isArray(payload?.questions)) continue;
    const secretIds = new Set<string>();
    for (const question of payload.questions) {
      if (question === null || typeof question !== "object") continue;
      const q = question as { id?: unknown; is_secret?: unknown };
      if (typeof q.id === "string" && q.is_secret === true) secretIds.add(q.id);
    }
    if (secretIds.size > 0) out.set(entryId, secretIds);
  }
  return out;
}

function stripSecretUserQueryAnswers(
  records: JsonlRecord[],
  summary: RedactionSummary,
  maxSamples: number,
): void {
  const secretByQueryId = secretQuestionIdsByQueryId(records);
  if (secretByQueryId.size === 0) return;
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query_response") continue;
    const payload = value.payload as { for_id?: unknown; answers?: unknown } | undefined;
    if (typeof payload?.for_id !== "string") continue;
    if (payload.answers === null || typeof payload.answers !== "object") continue;
    const secretIds = secretByQueryId.get(payload.for_id);
    if (secretIds === undefined) continue;
    const source = value.source as Record<string, unknown> | undefined;
    if (source !== undefined && source.raw !== undefined) {
      source.raw = { redacted: "[STRIPPED secret user_query_response source.raw]" };
      summary.counts.user_query_secret_source_raw =
        (summary.counts.user_query_secret_source_raw ?? 0) + 1;
      if (summary.samples.length < maxSamples) {
        summary.samples.push({
          patternId: "user_query_secret_source_raw",
          location: `records[${index}].source.raw`,
          before: "[secret source raw]",
          after: "[STRIPPED]",
        });
      }
    }
    const answers = payload.answers as Record<string, unknown>;
    for (const questionId of secretIds) {
      const answer = answers[questionId];
      if (answer === null || typeof answer !== "object") continue;
      const answerObject = answer as Record<string, unknown>;
      const hadSelected = Array.isArray(answerObject.selected) && answerObject.selected.length > 0;
      const hadOther = typeof answerObject.other === "string" && answerObject.other.length > 0;
      if (!hadSelected && !hadOther) continue;
      answerObject.selected = [];
      delete answerObject.other;
      summary.counts.user_query_secret_answer = (summary.counts.user_query_secret_answer ?? 0) + 1;
      if (summary.samples.length < maxSamples) {
        summary.samples.push({
          patternId: "user_query_secret_answer",
          location: `records[${index}].payload.answers.${questionId}`,
          before: "[secret answer]",
          after: "[STRIPPED]",
        });
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

function redactVisit(
  visit: Visit,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
): void {
  for (const pattern of userPatterns) {
    applyPattern(visit, pattern, summary, maxSamples);
  }
  for (const pattern of patterns) {
    applyPattern(visit, pattern, summary, maxSamples);
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

function redactString(
  value: string,
  location: string,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
): string {
  const container: Record<string, unknown> = { value };
  redactVisit(keyVisit(container, "value", location), userPatterns, patterns, summary, maxSamples);
  return container.value as string;
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

function uniqueKey(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) return preferred;
  let suffix = 2;
  let candidate = `${preferred}_${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${preferred}_${suffix}`;
  }
  return candidate;
}

function redactUserQueryQuestionIds(
  records: JsonlRecord[],
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
): Map<string, Map<string, string>> {
  const idMaps = new Map<string, Map<string, string>>();

  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query" || typeof value.id !== "string") continue;
    const payload = value.payload as { questions?: unknown } | undefined;
    if (!Array.isArray(payload?.questions)) continue;

    const used = new Set<string>();
    const idMap = new Map<string, string>();
    for (let i = 0; i < payload.questions.length; i += 1) {
      const question = payload.questions[i];
      if (question === null || typeof question !== "object") continue;
      const questionObject = question as Record<string, unknown>;
      const before = questionObject.id;
      if (typeof before !== "string") continue;
      const redacted = redactString(
        before,
        `records[${index}].payload.questions[${i}].id`,
        userPatterns,
        patterns,
        summary,
        maxSamples,
      );
      const after = redacted !== before ? uniqueKey(redacted, used) : redacted;
      questionObject.id = after;
      used.add(after);
      if (after !== before) idMap.set(before, after);
    }
    if (idMap.size > 0) idMaps.set(value.id, idMap);
  }

  return idMaps;
}

function redactUserQueryAnswerKeys(
  records: JsonlRecord[],
  queryIdMaps: Map<string, Map<string, string>>,
  userPatterns: RedactionPattern[],
  patterns: readonly RedactionPattern[],
  summary: RedactionSummary,
  maxSamples: number,
): void {
  for (const [index, record] of records.entries()) {
    const value = record.value as Record<string, unknown>;
    if (value.type !== "user_query_response") continue;
    const payload = value.payload as { for_id?: unknown; answers?: unknown } | undefined;
    if (typeof payload?.for_id !== "string") continue;
    if (payload.answers === null || typeof payload.answers !== "object") continue;

    const answers = payload.answers as Record<string, unknown>;
    const idMap = queryIdMaps.get(payload.for_id);
    const rewritten = Object.create(null) as Record<string, unknown>;
    const used = new Set<string>();
    let changed = false;
    for (const [before, answer] of Object.entries(answers)) {
      const redacted = redactString(
        before,
        `records[${index}].payload.answers.${before}`,
        userPatterns,
        patterns,
        summary,
        maxSamples,
      );
      const mapped = idMap?.get(before) ?? redacted;
      const after = uniqueKey(mapped, used);
      used.add(after);
      rewritten[after] = answer;
      if (after !== before) changed = true;
    }
    if (changed) payload.answers = rewritten;
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

  const queryIdMaps = redactUserQueryQuestionIds(
    out,
    userPatterns,
    patterns,
    rawSummary,
    maxSamples,
  );
  redactUserQueryAnswerKeys(out, queryIdMaps, userPatterns, patterns, rawSummary, maxSamples);

  stripSecretUserQueryAnswers(out, rawSummary, maxSamples);

  for (const visit of visitStrings(out, includeSourceRaw)) {
    redactVisit(visit, userPatterns, patterns, rawSummary, maxSamples);
  }

  truncateOutputs(out, outputMaxBytes, rawSummary, maxSamples);

  // Redacted bytes differ from the input artifact, so any finalized
  // content_hash carried on the input is now stale. Reset to the
  // <pending> sentinel (spec §7.3) on every session header and on the trail
  // envelope (spec §7.4, §8.6 multi-session) so strict verifiers do not flag
  // the mismatch and so share tooling recomputes the hashes on the redacted
  // artifact before publishing. Skip the reset on a true no-op pass so a
  // finalized clean trail remains verifiable after this call.
  const changed = Object.keys(rawSummary.counts).length > 0;
  if (changed) {
    for (const record of out) {
      const value = record.value as Record<string, unknown>;
      if (
        (value.type === "session" || value.type === "trail") &&
        typeof value.content_hash === "string"
      ) {
        value.content_hash = "<pending>";
      }
    }
  }

  // Resynchronize JsonlRecord.raw with mutated value so downstream consumers
  // that log or persist `.raw` cannot leak unredacted source text.
  for (const record of out) {
    record.raw = JSON.stringify(record.value);
  }

  return { records: out, summary: rawSummary };
}
