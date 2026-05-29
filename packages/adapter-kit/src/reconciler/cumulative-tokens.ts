import type { Entry } from "@agent-trail/types";
import { isObject } from "../primitives/guards.ts";

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Compute session-cumulative token counts for `agent_message` entries whose
 * `payload.usage` carries per-turn `input_tokens`/`output_tokens` but no
 * `*_cumulative` fields. Adapters whose source already emits cumulative counts
 * (e.g. Codex) leave this rule disabled. An entry already carrying a cumulative
 * field is left untouched, but its tokens still advance the running totals so a
 * source that emits cumulative counts intermittently stays consistent.
 *
 * Running totals accumulate in array (file-position) order. Adapters enabling
 * this rule must emit Pass-1 output in chronological order; the rule does not
 * sort defensively (that would mask adapter ordering bugs).
 */
export function cumulativeTokens(entries: Entry[]): Entry[] {
  let runningInput = 0;
  let runningOutput = 0;

  return entries.map((entry) => {
    if (entry.type !== "agent_message") return entry;
    const usage = (entry.payload as { usage?: unknown }).usage;
    if (!isObject(usage)) return entry;
    if (
      usage.input_tokens_cumulative !== undefined ||
      usage.output_tokens_cumulative !== undefined
    ) {
      // Source already carries cumulative counts for this turn — keep the entry
      // as-is but advance the running totals (authoritative cumulative value, or
      // running + turn delta) so later computed entries stay consistent.
      runningInput =
        numberOrUndefined(usage.input_tokens_cumulative) ??
        runningInput + (numberOrUndefined(usage.input_tokens) ?? 0);
      runningOutput =
        numberOrUndefined(usage.output_tokens_cumulative) ??
        runningOutput + (numberOrUndefined(usage.output_tokens) ?? 0);
      return entry;
    }

    const input = numberOrUndefined(usage.input_tokens);
    const output = numberOrUndefined(usage.output_tokens);
    if (input === undefined && output === undefined) return entry;

    runningInput += input ?? 0;
    runningOutput += output ?? 0;
    return {
      ...entry,
      payload: {
        ...entry.payload,
        usage: {
          ...usage,
          input_tokens_cumulative: runningInput,
          output_tokens_cumulative: runningOutput,
        },
      },
    } as Entry;
  });
}
