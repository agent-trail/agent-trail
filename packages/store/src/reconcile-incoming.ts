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
 * merged canonical bytes instead. `reason` on passthrough is set only when
 * the outcome is worth surfacing to the user (today: incoming has no
 * `session_uid`); other passthrough paths leave it `undefined`.
 */
export type ReconcileIncomingResult =
  | { kind: "passthrough"; reason?: "no_session_uid" }
  | { kind: "merged"; canonical: string; group: ReconcileGroup };

const SHORT_HASH_LEN = 12;

/**
 * Given an incoming trail's JSONL bytes and a local store root, find any
 * prior segments that share the incoming trail's `header.session_uid` and
 * reconcile them per spec §8.5. When matches are found the merged trail's
 * canonical bytes are returned for the caller to register; otherwise the
 * caller should register the incoming bytes unchanged.
 *
 * Failures (parse error, missing index, unreadable prior object) degrade to
 * `passthrough` so the load path never blocks on a partial store.
 */
export async function reconcileIncomingSegment(
  storeRoot: string,
  incomingJsonl: string,
): Promise<ReconcileIncomingResult> {
  let incomingRecords: JsonlRecord[];
  try {
    incomingRecords = await parseJsonlString(incomingJsonl);
  } catch {
    return { kind: "passthrough" };
  }
  const incomingUid = headerSessionUid(incomingRecords);
  if (incomingUid === null) return { kind: "passthrough", reason: "no_session_uid" };

  let matches: Awaited<ReturnType<typeof findEntriesBySessionUid>>;
  try {
    matches = await findEntriesBySessionUid(storeRoot, incomingUid);
  } catch {
    return { kind: "passthrough" };
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

  if (inputs.length < 2) return { kind: "passthrough" };

  const result = reconcileSegments(inputs);
  const group = result.groups.find((g) => g.segments.includes("incoming"));
  if (group === undefined || group.segments.length < 2) return { kind: "passthrough" };
  return { kind: "merged", canonical: group.canonical, group };
}

function headerSessionUid(records: JsonlRecord[]): string | null {
  for (const record of records) {
    if (record.value.type === "session") {
      const uid = (record.value as { session_uid?: unknown }).session_uid;
      return typeof uid === "string" ? uid : null;
    }
  }
  return null;
}
