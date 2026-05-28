import { createHash } from "node:crypto";

/**
 * Deterministic `session_uid` derivation for adapters (spec §8.5).
 *
 * Adapters previously minted `crypto.randomUUID()` per parse, which meant the
 * same upstream session re-parsed twice produced two different `session_uid`s
 * and the reconciler could not group them. RFC 4122 UUIDv5 derives a stable
 * UUID from `(namespace_uuid, name_string)` via SHA-1; pinning a per-adapter
 * namespace keeps upstream-id collisions across agents impossible while making
 * re-parses idempotent.
 *
 * Namespace UUIDs below are arbitrary, random v4 UUIDs — they only need to be
 * stable forever. Changing one is a corpus-wide migration.
 */

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
 * Derive a deterministic v5 UUID from `(namespace, upstreamId)` per RFC 4122
 * §4.3. Output is the hyphenated 36-char form accepted by the `session_uid`
 * schema (ULID/UUID union).
 */
export function deriveSessionUid(namespace: string, upstreamId: string): string {
  return deriveUuidV5(namespace, upstreamId);
}

/**
 * Derive a deterministic v5 UUID for an entry id synthesized by an adapter
 * (e.g., Claude Code's queue-operation/pr-link/permission-mode envelopes that
 * carry no source `uuid`). Seed parts are joined with the ASCII unit separator
 * (\x1f) so that distinct part sequences cannot alias each other.
 */
export function deriveSynthesizedEntryId(namespace: string, seedParts: readonly string[]): string {
  return deriveUuidV5(namespace, seedParts.join("\x1f"));
}

function deriveUuidV5(namespace: string, name: string): string {
  const namespaceBytes = parseUuidBytes(namespace);
  const hash = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16);
  // Version 5 in the top nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  // RFC 4122 variant (10xx) in the top bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function parseUuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32 || /[^0-9a-fA-F]/.test(hex)) {
    throw new TypeError(`Invalid namespace UUID: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
