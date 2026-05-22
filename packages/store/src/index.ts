/**
 * Agent Trail local content-addressed object store.
 *
 * Finalized trail artifacts live under
 * `<storeRoot>/objects/sha256/<content_hash>.trail.jsonl`, with mutable
 * metadata at `<storeRoot>/index/objects.json`. `storeRoot` defaults to
 * `~/.local/share/trail` and is overridable via the `AGENT_TRAIL_HOME`
 * env var or an explicit `storeRoot` option. See `docs/PRD.md` §8.3 for
 * the local-store contract.
 *
 * - `registerTrail` — validate + hash + write a trail to the store.
 *   Downstream CLI verbs (`trail share`, `trail load`, `trail handoff`,
 *   `trail view`) call this directly so users never type
 *   `trail register`.
 * - `rebuildIndex` — regenerate `index/objects.json` from on-disk
 *   objects after corruption or manual edits.
 * - `resolveStoreRoot` — resolve the effective store root for the
 *   current call site.
 */
export type { IndexEntry, IndexFile } from "./index-file.ts";
export { IndexCorruptError, IndexVersionError, readIndex } from "./index-file.ts";
export { objectPath, resolveStoreRoot } from "./paths.ts";
export type { RebuildIndexOptions, RebuildIndexResult } from "./rebuild.ts";
export { rebuildIndex } from "./rebuild.ts";
export type { RegisterOptions, RegisterResult, RegisterStatus } from "./register.ts";
export { registerTrail } from "./register.ts";
