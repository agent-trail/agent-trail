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
 * field is left untouched.
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
