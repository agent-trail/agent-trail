import { createDiagnostic, type Diagnostic } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";

/**
 * Stateless whole-file checks invoked by `validateTrailGraph` after the
 * stateful prologue (envelope/header validity, ID uniqueness, parent-DAG
 * cycle detection, hash verification) has produced the inputs each check
 * needs. Each function is pure: it reads its arguments and returns
 * diagnostics, with no side effects and no dependency on call order.
 *
 * Lives in its own module so adding or removing a whole-file rule is a
 * one-file edit instead of a patch in the middle of `validateTrailGraph`.
 */

// Checks header stream state against file content (spec §16.4 rule 9): a live
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

// Spec §16.4: writers should emit `session_terminated` if any `tool_call`
// remains unmatched at EOF. `session_end` signals a clean conclusion and
// suppresses the warning (spec §9.3). Pairing applies the full spec §9.5
// algorithm: primary explicit `for_id` reference, then the three-rule
// fallback cascade (semantic.call_id match, sequential, heuristic). The
// heuristic rule is reader-only and not implemented here.
export function unmatchedToolCallWarnings(entries: JsonlRecord[]): Diagnostic[] {
  type Call = { id: string; line: number; semanticCallId?: string; matched: boolean };
  type Result = { forId?: string; semanticCallId?: string; callIndex: number; matched: boolean };

  const calls: Call[] = [];
  const callById = new Map<string, Call>();
  const results: Result[] = [];
  let hasSessionEnd = false;
  const suppressedIds = new Set<string>();

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
        matched: false,
      };
      calls.push(call);
      callById.set(id, call);
    } else if (type === "tool_result") {
      const payload = entry.value.payload;
      const forIdRaw =
        typeof payload === "object" && payload !== null
          ? (payload as { for_id?: unknown }).for_id
          : undefined;
      results.push({
        forId: typeof forIdRaw === "string" ? forIdRaw : undefined,
        semanticCallId: readSemanticCallId(entry.value),
        callIndex: calls.length, // for sequential pairing: results pair only with calls prior to this entry
        matched: false,
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

  if (hasSessionEnd) {
    return [];
  }

  // Pass A: explicit `for_id` reference — primary pairing method (spec §9.5).
  // A `for_id` that resolves to an existing `tool_call` consumes the result
  // even if the call was already paired (duplicate result), so the result
  // does not fall through to the fallback cascade. Only a missing or
  // unresolvable `for_id` triggers fallback per §9.5.
  for (const result of results) {
    if (result.forId === undefined) {
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

  // Pass B: semantic.call_id match — spec §9.5 fallback rule 1.
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
    if (result.matched || result.semanticCallId === undefined) {
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

  // Pass C: sequential — spec §9.5 fallback rule 2. Each remaining unmatched
  // result pairs with the most recent prior unmatched tool_call.
  for (const result of results) {
    if (result.matched) {
      continue;
    }
    for (let i = result.callIndex - 1; i >= 0; i -= 1) {
      // i is bounded by calls.length (callIndex was captured as calls.length at
      // result-emit time, and calls is append-only thereafter).
      const call = calls[i] as Call;
      if (!call.matched) {
        call.matched = true;
        result.matched = true;
        break;
      }
    }
  }

  return calls
    .filter((c) => !c.matched && !suppressedIds.has(c.id))
    .map((call) =>
      createDiagnostic({
        line: call.line,
        path: "/id",
        severity: "warning",
        code: "unmatched_tool_call_at_eof",
        message: `tool_call "${call.id}" has no matching tool_result at EOF`,
      }),
    );
}

// Spec §9.3 / §16.4: `session_end.payload.final_message_id` should reference
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

// Inline-first / ref-subsequent envelope dedup (spec §9): an entry whose
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

// Spec §9.2: when payload.usage is present on agent_message, the writer must
// emit at least one of (input_tokens, input_tokens_cumulative) AND at least
// one of (output_tokens, output_tokens_cumulative). This is enforced as a
// whole-file diagnostic rather than via schema `anyOf` so the error code
// names the specific pair that's missing.
export function agentMessageUsageWarnings(entries: JsonlRecord[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const entry of entries) {
    if (entry.value.type !== "agent_message") {
      continue;
    }
    const payload = entry.value.payload;
    if (typeof payload !== "object" || payload === null) {
      continue;
    }
    const usage = (payload as { usage?: unknown }).usage;
    if (typeof usage !== "object" || usage === null) {
      continue;
    }
    const u = usage as Record<string, unknown>;
    const hasInput =
      typeof u.input_tokens === "number" || typeof u.input_tokens_cumulative === "number";
    const hasOutput =
      typeof u.output_tokens === "number" || typeof u.output_tokens_cumulative === "number";
    if (!hasInput) {
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: "/payload/usage",
          severity: "warning",
          code: "usage_missing_required",
          message:
            "payload.usage must include at least one of input_tokens or input_tokens_cumulative when present",
        }),
      );
    }
    if (!hasOutput) {
      diagnostics.push(
        createDiagnostic({
          line: entry.line,
          path: "/payload/usage",
          severity: "warning",
          code: "usage_missing_required",
          message:
            "payload.usage must include at least one of output_tokens or output_tokens_cumulative when present",
        }),
      );
    }
  }
  return diagnostics;
}

// Validates the optional envelope `sessions` manifest against the actual
// session header in the file. For v0.1.0 a trail file holds one session;
// the manifest, if present, must list exactly that session by id and agent
// name. Manifest drift is a warning so renderers can still display the file
// while flagging the inconsistency.
export function envelopeSessionsManifestWarnings(
  envelopeRecord: JsonlRecord,
  headerRecord: JsonlRecord | undefined,
): Diagnostic[] {
  const sessions = (envelopeRecord.value as { sessions?: unknown }).sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }
  const diagnostics: Diagnostic[] = [];

  if (sessions.length !== 1) {
    diagnostics.push(
      createDiagnostic({
        line: envelopeRecord.line,
        path: "/sessions",
        severity: "warning",
        code: "envelope_sessions_manifest_drift",
        message: `envelope.sessions lists ${sessions.length} session(s); v0.1.0 trail files contain exactly one session`,
      }),
    );
    return diagnostics;
  }

  if (headerRecord === undefined || headerRecord.value.type !== "session") {
    return diagnostics;
  }

  const declared = sessions[0];
  if (typeof declared !== "object" || declared === null) {
    return diagnostics;
  }
  const declaredId = (declared as { id?: unknown }).id;
  const declaredAgent = (declared as { agent?: unknown }).agent;
  const actualId = headerRecord.value.id;
  const actualAgentName =
    typeof headerRecord.value.agent === "object" && headerRecord.value.agent !== null
      ? (headerRecord.value.agent as { name?: unknown }).name
      : undefined;

  if (typeof declaredId === "string" && declaredId !== actualId) {
    diagnostics.push(
      createDiagnostic({
        line: envelopeRecord.line,
        path: "/sessions/0/id",
        severity: "warning",
        code: "envelope_sessions_manifest_drift",
        message: `envelope.sessions[0].id "${declaredId}" does not match session header id "${actualId ?? "<unknown>"}"`,
      }),
    );
  }
  if (typeof declaredAgent === "string" && declaredAgent !== actualAgentName) {
    diagnostics.push(
      createDiagnostic({
        line: envelopeRecord.line,
        path: "/sessions/0/agent",
        severity: "warning",
        code: "envelope_sessions_manifest_drift",
        message: `envelope.sessions[0].agent "${declaredAgent}" does not match session header agent.name "${typeof actualAgentName === "string" ? actualAgentName : "<unknown>"}"`,
      }),
    );
  }

  return diagnostics;
}

function readSemanticCallId(value: Record<string, unknown>): string | undefined {
  const semantic = value.semantic;
  if (typeof semantic !== "object" || semantic === null) {
    return undefined;
  }
  const callId = (semantic as { call_id?: unknown }).call_id;
  return typeof callId === "string" ? callId : undefined;
}
