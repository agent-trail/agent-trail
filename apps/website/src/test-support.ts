import { gzipSync } from "node:zlib";

import {
  canonicalizeRecords,
  computeContentHash,
  parseJsonlString,
} from "../../../packages/core/src/index.ts";

export const repoRoot = new URL("../../../", import.meta.url);

export async function seedSharedTrailPayload(
  opts: { overrideHash?: string; text?: string } = {},
): Promise<{ contentHash: string; filename: string; payloadText: string }> {
  return seedSharedTrailRecords(
    [
      {
        type: "user_message",
        id: "01HEVTA0000000000000000001",
        ts: "2026-05-17T14:00:05.000Z",
        payload: { text: opts.text ?? "hello from shared trail" },
      },
    ],
    opts,
  );
}

export async function seedSharedTrailRecords(
  records: Record<string, unknown>[],
  opts: { overrideHash?: string } = {},
): Promise<{ contentHash: string; filename: string; payloadText: string }> {
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  };
  const draft = `${[header, ...records].map((record) => JSON.stringify(record)).join("\n")}\n`;
  const contentHash = computeContentHash(await parseJsonlString(draft));
  header.content_hash = opts.overrideHash ?? contentHash;
  const canonical = canonicalizeRecords(
    await parseJsonlString(
      `${[header, ...records].map((record) => JSON.stringify(record)).join("\n")}\n`,
    ),
  );
  const payloadText = gzipSync(Buffer.from(canonical, "utf8")).toString("base64");
  return {
    contentHash,
    filename: `${contentHash.slice(0, 12)}.trail.jsonl.gz.b64`,
    payloadText,
  };
}
