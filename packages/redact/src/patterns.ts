// Re-export the curated pattern sets from @agent-trail/core. Individual
// pattern constants live in core too — import them from there directly if
// you need to compose a custom set. Iteration order of these arrays is
// load-bearing (specific patterns must precede generic ones), so we expose
// the constants rather than individual patterns to keep that contract.
export { CREDENTIAL_PATTERNS, DEFAULT_PATTERNS } from "@agent-trail/core";
