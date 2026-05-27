import { readFile } from "node:fs/promises";
import {
  type JsonlRecord,
  parseJsonlString,
  type ReconcileGroup,
  reconcileSegments,
} from "@agent-trail/core";
import { findEntriesBySessionUid } from "./index-file.ts";
import { objectPath } from "./paths.ts";

/**
 * Outcome of attempting to reconcile an incoming segment trail against the
 * local store. `passthrough` means the caller should register the original
 * incoming bytes unchanged; `merged` means the caller should register the
 * merged canonical bytes instead.
 *
 * On `passthrough`, `reason` distinguishes intentional non-merge cases from
 * failures:
 *   - `"no_session_uid"`: incoming trail has no `session_uid`, so it can't
 *     be matched against priors. Intentional, not an error.
 *   - `"store_error"`: incoming bytes failed to parse, or the store index
 *     could not be queried. Reconciliation could not run.
 *   - `"corrupt_prior"`: a matching prior was found but no usable prior
 *     records could be loaded (all reads/parses failed).
 *   - `undefined`: no priors matched, or only the incoming segment survived
 *     reconciliation. Intentional, not an error.
 */
export type ReconcileIncomingResult =
  | { kind: "passthrough"; reason?: "no_session_uid" | "store_error" | "corrupt_prior" }
  | { kind: "merged"; canonical: string; group: ReconcileGroup };

const SHORT_HASH_LEN = 12;

/**
 * Given an incoming trail's JSONL bytes and a local store root, find any
 * prior segments that share the incoming trail's `header.session_uid` and
 * reconcile them per spec §8.5. When matches are found the merged trail's
 * canonical bytes are returned for the caller to register; otherwise the
 * caller should register the incoming bytes unchanged.
 *
 * Never throws: failures degrade to a `passthrough` result with `reason`
 * set so the caller can surface the cause. See `ReconcileIncomingResult`
 * for the full list of reasons.
 */
export async function reconcileIncomingSegment(
  storeRoot: string,
  incomingJsonl: string,
): Promise<ReconcileIncomingResult> {
  let incomingRecords: JsonlRecord[];
  try {
    incomingRecords = await parseJsonlString(incomingJsonl);
  } catch {
    return { kind: "passthrough", reason: "store_error" };
  }
  const incomingUid = headerSessionUid(incomingRecords);
  if (incomingUid === null) return { kind: "passthrough", reason: "no_session_uid" };

  let matches: Awaited<ReturnType<typeof findEntriesBySessionUid>>;
  try {
    matches = await findEntriesBySessionUid(storeRoot, incomingUid);
  } catch {
    return { kind: "passthrough", reason: "store_error" };
  }
  if (matches.length === 0) return { kind: "passthrough" };

  const inputs = [{ source: "incoming", records: incomingRecords }];
  for (const match of matches) {
    const objPath = objectPath(storeRoot, match.contentHash);
    try {
      const raw = await readFile(objPath, "utf8");
      const records = await parseJsonlString(raw);
      inputs.push({ source: match.contentHash.slice(0, SHORT_HASH_LEN), records });
    } catch {
      // Skip unreadable / corrupted store entries; reconcile still proceeds
      // with whatever segments are intact.
    }
  }

  // Matches existed but every prior failed to load: surface as corrupt_prior
  // so the caller can warn the user that reconciliation was supposed to run.
  if (inputs.length < 2) return { kind: "passthrough", reason: "corrupt_prior" };

  const result = reconcileSegments(inputs);
  const group = result.groups.find((g) => g.segments.includes("incoming"));
  if (group === undefined || group.segments.length < 2) return { kind: "passthrough" };
  return { kind: "merged", canonical: group.canonical, group };
}

function headerSessionUid(records: JsonlRecord[]): string | null {
  // Spec requires exactly one `session` header per trail; the first match is
  // authoritative. Reader-tolerant parsing in core handles malformed inputs.
  for (const record of records) {
    if (record.value.type === "session") {
      const uid = (record.value as { session_uid?: unknown }).session_uid;
      return typeof uid === "string" ? uid : null;
    }
  }
  return null;
}
