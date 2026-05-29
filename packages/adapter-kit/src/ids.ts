import { createHash } from "node:crypto";

/**
 * Deterministic id derivation shared by all adapters (spec §8.5).
 *
 * Adapters must mint stable ids: the same upstream session re-parsed twice has
 * to produce the same `session_uid` and entry ids, or the reconciler cannot
 * group/dedup. RFC 4122 UUIDv5 derives a stable UUID from
 * `(namespace_uuid, name_string)` via SHA-1; per-adapter namespaces keep
 * cross-agent collisions impossible while making re-parses idempotent.
 *
 * Namespace UUIDs live with each adapter (or `defineAdapter` config) — these
 * helpers are namespace-agnostic and carry no adapter knowledge.
 */

/**
 * Derive a deterministic v5 UUID from `(namespace, upstreamId)` per RFC 4122
 * §4.3. Output is the hyphenated 36-char form accepted by the `session_uid`
 * schema (ULID/UUID union).
 */
export function deriveSessionUid(namespace: string, upstreamId: string): string {
  return deriveUuidV5(namespace, upstreamId);
}

/**
 * Derive a deterministic v5 UUID for an entry id synthesized by an adapter or
 * the mapping engine. Seed parts are joined with the ASCII unit separator
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
