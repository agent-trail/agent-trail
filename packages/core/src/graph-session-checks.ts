import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { finalSessionTerminatedReason, isQuarantinedUnknownRecord } from "./parse-fidelity.ts";

export function nonMonotonicEventTsWarnings(
  entries: JsonlRecord[],
  parentIds: Map<string, string>,
  cyclicIds: Set<string>,
): Diagnostic[] {
  const entryById = new Map<string, JsonlRecord>();
  for (const entry of entries) {
    const id = entry.value.id;
    if (typeof id === "string" && !entryById.has(id)) {
      entryById.set(id, entry);
    }
  }

  const diagnostics: Diagnostic[] = [];
  for (const [id, parentId] of parentIds) {
    if (cyclicIds.has(id) || cyclicIds.has(parentId)) continue;
    const entry = entryById.get(id);
    if (entry === undefined) continue;
    const parent = entryById.get(parentId);
    if (parent === undefined) continue;

    const childTs = eventTimestampMillis(entry);
    const parentTs = eventTimestampMillis(parent);
    if (childTs === undefined || parentTs === undefined || childTs >= parentTs) continue;

    diagnostics.push(
      createDiagnostic({
        line: entry.line,
        path: "/ts",
        severity: "warning",
        code: "non_monotonic_event_ts",
        message: `event "${id}" has ts earlier than parent_id "${parentId}"`,
      }),
    );
  }

  return diagnostics;
}

// Checks header stream state against file content (spec §18.4 rule 9): a live
// header (stream.state == "open") must not carry a populated content_hash and
// must not coexist with terminal events. Both checks are conditional on the
// open state; closed/absent streams are validated elsewhere.
export function streamConsistencyWarnings(
  headerRecord: JsonlRecord,
  entries: JsonlRecord[],
): Diagnostic[] {
  const stream = headerRecord.value.stream;
  if (typeof stream !== "object" || stream === null) {
    return [];
  }
  const state = (stream as { state?: unknown }).state;
  if (state !== "open") {
    return [];
  }

  const diagnostics: Diagnostic[] = [];
  const contentHash = headerRecord.value.content_hash;
  if (typeof contentHash === "string" && contentHash !== "<pending>") {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord.line,
        path: "/content_hash",
        severity: "warning",
        code: "stream_open_with_content_hash",
        message:
          'Header has stream.state "open" but content_hash is populated; live files should omit content_hash or use "<pending>"',
      }),
    );
  }

  for (const entry of entries) {
    const type = entry.value.type;
    if (type === "session_end" || type === "session_terminated") {
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: "/type",
          severity: "warning",
          code: "stream_open_with_terminal_event",
          message: `Header has stream.state "open" but file contains a terminal "${type}" event; finalize the header before emitting terminal events`,
        }),
      );
    }
  }

  return diagnostics;
}

function eventTimestampMillis(record: JsonlRecord): number | undefined {
  const ts = record.value.ts;
  if (typeof ts !== "string") return undefined;
  const parsed = new Date(ts);
  const millis = parsed.getTime();
  if (!Number.isFinite(millis) || parsed.toISOString() !== ts) return undefined;
  return millis;
}

// Spec §18.4: writers should emit `session_terminated` if any `tool_call`
// remains unmatched at EOF. `session_end` signals a clean conclusion and
// suppresses the warning (spec §10.3). Pairing applies the full spec §10.5
// algorithm: primary explicit `for_id` reference, then the three-rule
// fallback cascade (semantic.call_id match, sequential, heuristic). The
// heuristic rule is reader-only and not implemented here.
export function unmatchedToolCallWarnings(entries: JsonlRecord[]): Diagnostic[] {
  type Call = {
    id: string;
    line: number;
    semanticCallId?: string;
    parentId?: string;
    branchScope: string;
    matched: boolean;
  };
  type Result = {
    line: number;
    forId?: string;
    semanticCallId?: string;
    parentId?: string;
    branchScope: string;
    callIndex: number;
    matched: boolean;
    canFallback: boolean;
    canExplicitMatch: boolean;
  };

  const calls: Call[] = [];
  const callById = new Map<string, Call>();
  const results: Result[] = [];
  const entryById = new Map<string, JsonlRecord>();
  const childCounts = new Map<string, number>();
  let hasSessionEnd = false;
  const suppressedIds = new Set<string>();

  for (const entry of entries) {
    const id = entry.value.id;
    if (typeof id !== "string") continue;
    entryById.set(id, entry);
    const parentId = entry.value.parent_id;
    if (typeof parentId === "string") {
      childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
    }
  }

  for (const entry of entries) {
    const type = entry.value.type;
    if (type === "tool_call") {
      const id = entry.value.id;
      if (typeof id !== "string") {
        continue;
      }
      const call: Call = {
        id,
        line: entry.line,
        semanticCallId: readSemanticCallId(entry.value),
        parentId: readParentId(entry),
        branchScope: branchScopeFor(entry, entryById, childCounts),
        matched: false,
      };
      calls.push(call);
      callById.set(id, call);
    } else if (type === "tool_result" || type === "tool_call_aborted") {
      const payload = entry.value.payload;
      const forIdRaw =
        typeof payload === "object" && payload !== null
          ? (payload as { for_id?: unknown }).for_id
          : undefined;
      const scope =
        typeof payload === "object" && payload !== null
          ? (payload as { scope?: unknown }).scope
          : undefined;
      results.push({
        line: entry.line,
        forId: typeof forIdRaw === "string" ? forIdRaw : undefined,
        semanticCallId: type === "tool_result" ? readSemanticCallId(entry.value) : undefined,
        parentId: readParentId(entry),
        branchScope: branchScopeFor(entry, entryById, childCounts),
        callIndex: calls.length, // for sequential pairing: results pair only with calls prior to this entry
        matched: false,
        canFallback: type === "tool_result",
        canExplicitMatch: type === "tool_result" || scope === "tool_call",
      });
    } else if (type === "session_end") {
      hasSessionEnd = true;
    } else if (type === "session_terminated") {
      const payload = entry.value.payload;
      if (typeof payload === "object" && payload !== null) {
        const openIds = (payload as { open_call_ids?: unknown }).open_call_ids;
        if (Array.isArray(openIds)) {
          for (const openId of openIds) {
            if (typeof openId === "string") {
              suppressedIds.add(openId);
            }
          }
        }
      }
    }
  }

  // Pass A: explicit `for_id` reference — primary pairing method (spec §10.5).
  // A `for_id` that resolves to an existing `tool_call` consumes the result
  // even if the call was already paired (duplicate result), so the result
  // does not fall through to the fallback cascade. Only a missing or
  // unresolvable `for_id` triggers fallback per §10.5.
  for (const result of results) {
    if (!result.canExplicitMatch || result.forId === undefined) {
      continue;
    }
    const call = callById.get(result.forId);
    if (call === undefined) {
      continue;
    }
    result.matched = true;
    if (!call.matched) {
      call.matched = true;
    }
  }

  // Pass B: semantic.call_id match — spec §10.5 fallback rule 1.
  const callsBySemanticCallId = new Map<string, Call[]>();
  for (const call of calls) {
    if (call.matched || call.semanticCallId === undefined) {
      continue;
    }
    const bucket = callsBySemanticCallId.get(call.semanticCallId);
    if (bucket === undefined) {
      callsBySemanticCallId.set(call.semanticCallId, [call]);
    } else {
      bucket.push(call);
    }
  }
  for (const result of results) {
    if (result.matched || !result.canFallback || result.semanticCallId === undefined) {
      continue;
    }
    const bucket = callsBySemanticCallId.get(result.semanticCallId);
    if (bucket === undefined || bucket.length === 0) {
      continue;
    }
    // shift() on a non-empty array always returns the element.
    const call = bucket.shift() as Call;
    call.matched = true;
    result.matched = true;
  }

  // Pass C: sequential — spec §10.5 fallback rule 2. Each remaining unmatched
  // result pairs with the most recent prior unmatched tool_call in the same
  // branch scope.
  const diagnostics: Diagnostic[] = [];
  for (const result of results) {
    if (result.matched || !result.canFallback) {
      continue;
    }
    const candidates: Call[] = [];
    for (let i = result.callIndex - 1; i >= 0; i -= 1) {
      // i is bounded by calls.length (callIndex was captured as calls.length at
      // result-emit time, and calls is append-only thereafter).
      const call = calls[i] as Call;
      if (!call.matched && isSequentialCandidate(call, result)) candidates.push(call);
    }
    const call = candidates[0];
    if (call !== undefined) {
      call.matched = true;
      result.matched = true;
      if (candidates.length >= 2) {
        diagnostics.push(
          createDiagnostic({
            line: result.line,
            path: "/payload",
            severity: "warning",
            code: "ambiguous_sequential_pairing",
            message: `tool_result was paired by sequential fallback with ${candidates.length} unmatched prior tool_call candidates; writers should populate payload.for_id or semantic.call_id`,
          }),
        );
      }
    }
  }

  if (!hasSessionEnd) {
    diagnostics.push(
      ...calls
        .filter((c) => !c.matched && !suppressedIds.has(c.id))
        .map((call) =>
          createDiagnostic({
            line: call.line,
            path: "/id",
            severity: "warning",
            code: "unmatched_tool_call_at_eof",
            message: `tool_call "${call.id}" has no matching tool_result or call-scoped tool_call_aborted at EOF`,
          }),
        ),
    );
  }
  return diagnostics;
}

function isSequentialCandidate(
  call: { branchScope: string; parentId?: string },
  result: { branchScope: string; parentId?: string },
): boolean {
  return (
    call.branchScope === result.branchScope ||
    (call.parentId !== undefined && call.parentId === result.parentId)
  );
}

function readParentId(entry: JsonlRecord): string | undefined {
  const parentId = entry.value.parent_id;
  return typeof parentId === "string" ? parentId : undefined;
}

function branchScopeFor(
  entry: JsonlRecord,
  entryById: Map<string, JsonlRecord>,
  childCounts: Map<string, number>,
): string {
  let current = entry;
  const seen = new Set<string>();

  while (true) {
    const parentId = current.value.parent_id;
    if (typeof parentId !== "string" || seen.has(parentId)) return "root";
    seen.add(parentId);

    const parent = entryById.get(parentId);
    if (parent === undefined) return "root";
    if ((childCounts.get(parentId) ?? 0) > 1) {
      const childId = current.value.id;
      return typeof childId === "string" ? `branch:${parentId}:${childId}` : `branch:${parentId}`;
    }
    if (isSubagentInvoke(parent)) return `subagent:${parentId}`;

    current = parent;
  }
}

function isSubagentInvoke(entry: JsonlRecord): boolean {
  if (entry.value.type !== "tool_call") return false;
  const payload = entry.value.payload;
  if (typeof payload !== "object" || payload === null) return false;
  return (payload as { tool?: unknown }).tool === "subagent_invoke";
}

// Spec §10.3 / §18.4: `session_end.payload.final_message_id` should reference
// the session header or a *prior* event in the same file. Warn when it does
// not resolve, or when it resolves to an event that appears at or after the
// `session_end` line (forward references hide ordering bugs).
export function finalMessageIdWarnings(
  entries: JsonlRecord[],
  idLines: Map<string, number>,
  headerId: string | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const entry of entries) {
    if (entry.value.type !== "session_end") {
      continue;
    }
    const payload = entry.value.payload;
    if (typeof payload !== "object" || payload === null) {
      continue;
    }
    const finalId = (payload as { final_message_id?: unknown }).final_message_id;
    if (typeof finalId !== "string") {
      continue;
    }
    if (finalId === headerId) {
      continue;
    }
    const finalLine = idLines.get(finalId);
    if (finalLine !== undefined && finalLine < entry.line) {
      continue;
    }
    diagnostics.push(
      createDiagnostic({
        line: entry.line,
        path: "/payload/final_message_id",
        severity: "warning",
        code: "unknown_final_message_id",
        message: `session_end final_message_id "${finalId}" does not reference the session header or a prior event in this file`,
      }),
    );
  }
  return diagnostics;
}

// Inline-first / ref-subsequent envelope dedup (spec §10): an entry whose
// source.raw.envelope_ref is set MUST reference an earlier entry's id. The
// referenced entry inlined the source envelope; the current entry rides on
// that envelope. Forward refs and dangling refs are errors so streaming
// readers can resolve refs in a single pass.
export function envelopeRefWarnings(
  entries: JsonlRecord[],
  idLines: Map<string, number>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const entry of entries) {
    const source = entry.value.source;
    if (typeof source !== "object" || source === null) {
      continue;
    }
    const raw = (source as { raw?: unknown }).raw;
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const envelopeRef = (raw as { envelope_ref?: unknown }).envelope_ref;
    if (typeof envelopeRef !== "string") {
      continue;
    }
    const targetLine = idLines.get(envelopeRef);
    if (targetLine !== undefined && targetLine < entry.line) {
      continue;
    }
    diagnostics.push(
      createDiagnostic({
        line: entry.line,
        path: "/source/raw/envelope_ref",
        severity: "error",
        code: "source_raw_envelope_ref_unresolved",
        message: `source.raw.envelope_ref "${envelopeRef}" does not reference an earlier entry in this file`,
      }),
    );
  }
  return diagnostics;
}

// Spec §10.4: `user_query_response.payload.for_id` links to a prior
// `user_query` entry, and each `answers` key names one of that query's
// `questions[].id` values. The JSON Schema validates the per-record shape;
// this graph check validates the cross-record contract.
export function userQueryResponseWarnings(entries: JsonlRecord[]): Diagnostic[] {
  type Query = { questionIds: Set<string> };

  const diagnostics: Diagnostic[] = [];
  const queryById = new Map<string, Query>();

  for (const entry of entries) {
    if (entry.value.type !== "user_query") continue;
    const id = entry.value.id;
    const payload = entry.value.payload;
    if (typeof id !== "string" || typeof payload !== "object" || payload === null) continue;
    const questions = (payload as { questions?: unknown }).questions;
    const questionIds = new Set<string>();
    if (Array.isArray(questions)) {
      for (const [index, question] of questions.entries()) {
        if (typeof question !== "object" || question === null) continue;
        const questionId = (question as { id?: unknown }).id;
        if (typeof questionId === "string") {
          if (questionIds.has(questionId)) {
            diagnostics.push(
              createDiagnostic({
                line: entry.line,
                path: `/payload/questions/${index}/id`,
                severity: "error",
                code: "duplicate_user_query_question_id",
                message: `user_query question id "${questionId}" is duplicated within this query`,
              }),
            );
          }
          questionIds.add(questionId);
        }
        const options = (question as { options?: unknown }).options;
        if (Array.isArray(options)) {
          const labels = new Map<string, { allHaveStableIds: boolean; warned: boolean }>();
          for (const [optionIndex, option] of options.entries()) {
            if (typeof option !== "object" || option === null) continue;
            const optionId = (option as { id?: unknown }).id;
            const label = (option as { label?: unknown }).label;
            if (typeof label !== "string") continue;
            const hasStableId = typeof optionId === "string" && optionId.length > 0;
            const prior = labels.get(label);
            if (!prior) {
              labels.set(label, { allHaveStableIds: hasStableId, warned: false });
              continue;
            }
            prior.allHaveStableIds = prior.allHaveStableIds && hasStableId;
            if (!prior.allHaveStableIds && !prior.warned) {
              diagnostics.push(
                createDiagnostic({
                  line: entry.line,
                  path: `/payload/questions/${index}/options/${optionIndex}/label`,
                  severity: "warning",
                  code: "duplicate_option_labels",
                  message: `user_query question "${
                    typeof questionId === "string" ? questionId : index
                  }" has duplicate option label "${label}" without stable option ids; user_query_response selected values may be ambiguous`,
                }),
              );
              prior.warned = true;
            }
          }
        }
      }
    }
    queryById.set(id, { questionIds });
  }

  for (const entry of entries) {
    if (entry.value.type !== "user_query_response") continue;
    const payload = entry.value.payload;
    if (typeof payload !== "object" || payload === null) continue;
    const forId = (payload as { for_id?: unknown }).for_id;
    if (typeof forId !== "string") continue;
    const query = queryById.get(forId);
    if (query === undefined) {
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: "/payload/for_id",
          severity: "error",
          code: "unknown_user_query_response_for_id",
          message: `user_query_response for_id "${forId}" does not reference a user_query in this session`,
        }),
      );
      continue;
    }

    const answers = (payload as { answers?: unknown }).answers;
    if (typeof answers !== "object" || answers === null || Array.isArray(answers)) continue;
    for (const questionId of Object.keys(answers)) {
      if (query.questionIds.has(questionId)) continue;
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: `/payload/answers/${escapeJsonPointer(questionId)}`,
          severity: "error",
          code: "unknown_user_query_answer_key",
          message: `user_query_response answer key "${questionId}" does not match a question id on user_query "${forId}"`,
        }),
      );
    }
  }

  return diagnostics;
}

export function parseFidelityConsistencyWarnings(
  headerRecord: JsonlRecord,
  entries: JsonlRecord[],
): Diagnostic[] {
  const parseFidelity = headerRecord.value.parse_fidelity;
  if (typeof parseFidelity !== "object" || parseFidelity === null) {
    return [];
  }
  const summary = parseFidelity as { quarantined_count?: unknown; termination_reason?: unknown };
  const claimedQuarantinedCount = summary.quarantined_count;
  const claimedTerminationReason = summary.termination_reason;
  const diagnostics: Diagnostic[] = [];

  const actualQuarantinedCount = entries.filter(isQuarantinedUnknownRecord).length;
  if (
    typeof claimedQuarantinedCount === "number" &&
    Number.isInteger(claimedQuarantinedCount) &&
    claimedQuarantinedCount !== actualQuarantinedCount
  ) {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord.line,
        path: "/parse_fidelity/quarantined_count",
        severity: "error",
        code: "parse_fidelity_mismatch",
        message: `parse_fidelity.quarantined_count is ${claimedQuarantinedCount} but session contains ${actualQuarantinedCount} quarantined unknown_record event(s)`,
      }),
    );
  }

  const actualTerminationReason = finalSessionTerminatedReason(entries);
  if (actualTerminationReason === undefined) {
    if (claimedTerminationReason !== undefined) {
      diagnostics.push(
        createDiagnostic({
          line: headerRecord.line,
          path: "/parse_fidelity/termination_reason",
          severity: "error",
          code: "parse_fidelity_mismatch",
          message: `parse_fidelity.termination_reason is "${String(claimedTerminationReason)}" but session contains no session_terminated event`,
        }),
      );
    }
  } else if (claimedTerminationReason === undefined) {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord.line,
        path: "/parse_fidelity/termination_reason",
        severity: "error",
        code: "parse_fidelity_mismatch",
        message: `parse_fidelity.termination_reason is absent but final session_terminated reason is "${actualTerminationReason}"`,
      }),
    );
  } else if (claimedTerminationReason !== actualTerminationReason) {
    diagnostics.push(
      createDiagnostic({
        line: headerRecord.line,
        path: "/parse_fidelity/termination_reason",
        severity: "error",
        code: "parse_fidelity_mismatch",
        message: `parse_fidelity.termination_reason is "${String(claimedTerminationReason)}" but final session_terminated reason is "${actualTerminationReason}"`,
      }),
    );
  }

  return diagnostics;
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function readSemanticCallId(value: Record<string, unknown>): string | undefined {
  const semantic = value.semantic;
  if (typeof semantic !== "object" || semantic === null) {
    return undefined;
  }
  const callId = (semantic as { call_id?: unknown }).call_id;
  return typeof callId === "string" ? callId : undefined;
}
