export type AgentMessageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_cumulative?: number;
  output_tokens_cumulative?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  reasoning_tokens?: number;
};

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

// Returns the first non-negative-integer value across the candidate key list.
// Token-counting fields are always non-negative integers, so non-integers and
// negatives are treated as "absent" rather than coerced.
export function pick(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = nonNegativeInteger(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

// Maps a source-agent usage envelope to spec §9.2 payload.usage. Accepts both
// snake_case (Anthropic API, claude-code) and camelCase (Pi internal) field
// names. Renames cache_*_input_tokens to cache_*_tokens (spec name) and drops
// vendor extras (service_tier, etc.). Returns undefined when the source emits
// no usable usage data — decision #4 forbids fabricating zeros.
export function mapAgentMessageUsage(raw: unknown): AgentMessageUsage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const src = raw as Record<string, unknown>;
  const usage: AgentMessageUsage = {};
  const inputTokens = pick(src, ["input_tokens", "inputTokens"]);
  if (inputTokens !== undefined) usage.input_tokens = inputTokens;
  const outputTokens = pick(src, ["output_tokens", "outputTokens"]);
  if (outputTokens !== undefined) usage.output_tokens = outputTokens;
  const inputCumulative = pick(src, [
    "input_tokens_cumulative",
    "inputTokensCumulative",
    "cumulativeInputTokens",
  ]);
  if (inputCumulative !== undefined) usage.input_tokens_cumulative = inputCumulative;
  const outputCumulative = pick(src, [
    "output_tokens_cumulative",
    "outputTokensCumulative",
    "cumulativeOutputTokens",
  ]);
  if (outputCumulative !== undefined) usage.output_tokens_cumulative = outputCumulative;
  // Anthropic source: cache_read_input_tokens → spec: cache_read_tokens.
  // Pi camelCase variants accepted defensively.
  const cacheRead = pick(src, [
    "cache_read_input_tokens",
    "cache_read_tokens",
    "cacheReadInputTokens",
    "cacheReadTokens",
  ]);
  if (cacheRead !== undefined) usage.cache_read_tokens = cacheRead;
  // Anthropic source: cache_creation_input_tokens → spec: cache_creation_tokens.
  const cacheCreate = pick(src, [
    "cache_creation_input_tokens",
    "cache_creation_tokens",
    "cacheCreationInputTokens",
    "cacheCreationTokens",
  ]);
  if (cacheCreate !== undefined) usage.cache_creation_tokens = cacheCreate;
  const reasoning = pick(src, ["reasoning_tokens", "reasoningTokens"]);
  if (reasoning !== undefined) usage.reasoning_tokens = reasoning;
  return Object.keys(usage).length > 0 ? usage : undefined;
}
