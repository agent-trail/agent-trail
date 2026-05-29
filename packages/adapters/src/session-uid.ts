/**
 * Per-adapter namespace UUIDs for deterministic `session_uid`/entry-id
 * derivation (spec §8.5). The derivation helpers themselves live in
 * `@agent-trail/adapter-kit` (shared by the mapping engine); this module pins
 * the per-adapter namespaces and re-exports the helpers.
 *
 * Namespace UUIDs below are arbitrary, random v4 UUIDs — they only need to be
 * stable forever. Changing one is a corpus-wide migration.
 */
export { deriveSessionUid, deriveSynthesizedEntryId } from "@agent-trail/adapter-kit";

/** Namespace for Claude Code adapter session_uids. Stable forever — do not change. */
export const CLAUDE_CODE_SESSION_UID_NAMESPACE = "b4a0f5e1-7c23-4d8a-9e12-3f4b5c6d7e8f";

/** Namespace for Pi adapter session_uids. Stable forever — do not change. */
export const PI_SESSION_UID_NAMESPACE = "c5b1f6e2-8d34-4e9b-af23-405c6d7e8f90";

/** Namespace for Codex CLI adapter session_uids. Stable forever — do not change. */
export const CODEX_SESSION_UID_NAMESPACE = "d7e3a8f4-9f56-4abd-c045-627e8f9a0b12";

/**
 * Namespace for Claude Code synthesized entry ids (queue-operation, pr-link,
 * permission-mode envelopes that lack a source uuid). Stable forever — do not
 * change.
 */
export const CLAUDE_CODE_SYNTHESIZED_ENTRY_ID_NAMESPACE = "d6c2f7e3-9e45-4fac-bf34-516d7e8f9a01";

/**
 * Namespace for Codex CLI entry ids. Codex rollouts give us no per-record
 * uuid, so every entry id is derived from (session_uid, record_index,
 * entry_type) to keep re-parses idempotent per spec §8.5. Stable forever — do
 * not change.
 */
export const CODEX_ENTRY_ID_NAMESPACE = "e8f4b9a5-af67-4bcd-d156-738f9a0b1c23";

/**
 * Namespace for Pi adapter entry ids. Real Pi envelopes carry 8-char hex
 * source ids that do not match the v0.1 `#/$defs/id` ULID/UUID pattern, so
 * every emitted entry id is derived from (session_uid, source_id [, suffix])
 * to satisfy the schema while staying idempotent across re-parses. Stable
 * forever — do not change.
 */
export const PI_ENTRY_ID_NAMESPACE = "f9a5cab6-b078-4cde-e267-849a0b1c2d34";

/**
 * Namespace for Claude Code adapter entry ids (source-uuid-bearing
 * envelopes: user, assistant, summary). Mirrors `PI_ENTRY_ID_NAMESPACE` —
 * real cc sessions ship UUID-shaped source uuids today so the deterministic
 * derivation is invisible in practice, but the path is identical to Pi's
 * (issue #137) and the v0.1 id contract holds for any shape source uuid.
 * Source-uuid-less envelopes (queue-operation, pr-link, permission-mode)
 * keep using `CLAUDE_CODE_SYNTHESIZED_ENTRY_ID_NAMESPACE`. Stable forever —
 * do not change.
 */
export const CLAUDE_CODE_ENTRY_ID_NAMESPACE = "0a16dbc7-c189-4def-f378-95ab1c2d3e45";
