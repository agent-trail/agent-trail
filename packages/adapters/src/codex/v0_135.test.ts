import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDiagnosticsText, validateWriterStrictRecord } from "@agent-trail/core";
import type { Entry } from "@agent-trail/types";
import { parseCodexEntries } from "./kit.ts";
import { INLINE_IMAGE_MAX_DECODED_BYTES } from "./mappings.ts";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/codex");
const PNG_SHA256 = "sha256:02a3e298f1533f62558c58e4c70edcab9af5a50d62d925fd5390942020fb0fb8";
const entries = (): Promise<Entry[]> =>
  parseCodexEntries(join(FIXTURES, "v0_135-events.jsonl"), "unit-test");
const capabilityEntries = (): Promise<Entry[]> =>
  parseCodexEntries(join(FIXTURES, "capability-changes.jsonl"), "unit-test");

function expectWriterStrict(entries: Entry[]): void {
  for (const [index, entry] of entries.entries()) {
    expect(
      formatDiagnosticsText(
        validateWriterStrictRecord({ line: index + 2, raw: JSON.stringify(entry), value: entry }),
      ),
    ).toBe("");
  }
}

// Codex 0.135 (cli_version >= 0.129) resolves the codex/v0.135 source-schema,
// which recognizes the subtypes 0.135 added: response_item.message,
// event_msg.{context_compacted,item_completed,turn_aborted}. Two carry genuinely
// new signal and are mapped; two duplicate already-captured records and are
// intentionally suppressed (recognized by the schema, not quarantined).
describe("codex v0.135 new event subtypes", () => {
  test("turn_aborted (reason: interrupted) → user_interrupt", async () => {
    const all = await entries();
    const interrupts = all.filter((e) => e.type === "user_interrupt");
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]?.payload).toEqual({ reason: "interrupted" });
    expect(interrupts[0]?.source?.original_type).toBe("event_msg.turn_aborted");
    expect(interrupts[0]?.meta).toMatchObject({
      "dev.codex.raw_type": "event_msg.turn_aborted",
      completed_at: 1717236008000,
      duration_ms: 5000,
      turn_id: "turn-1",
    });
  });

  test("item_completed (Plan) → system_event preserving the item", async () => {
    const all = await entries();
    const planEvents = all.filter(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "x-codex/item_completed",
    );
    expect(planEvents).toHaveLength(1);
    const data = (
      planEvents[0]?.payload as {
        data?: { completed_at_ms?: number; item?: { type?: string }; thread_id?: string };
      }
    ).data;
    expect(data?.item?.type).toBe("Plan");
    expect(data?.thread_id).toBe("thread-1");
    expect(data?.completed_at_ms).toBe(1717236003000);
  });

  test("response_item.message is suppressed (duplicates event_msg messages, not quarantined)", async () => {
    const all = await entries();
    // exactly one user_message + one agent_message, from the event_msg records;
    // the two response_item.message duplicates emit nothing.
    expect(all.filter((e) => e.type === "user_message")).toHaveLength(1);
    expect(all.filter((e) => e.type === "agent_message")).toHaveLength(1);
    // and nothing quarantined.
    expect(
      all.filter(
        (e) =>
          e.type === "system_event" &&
          String((e.payload as { kind?: string }).kind).endsWith("/unknown_record"),
      ),
    ).toHaveLength(0);
  });

  test("event_msg.context_compacted is suppressed (duplicates the `compacted` record)", async () => {
    const all = await entries();
    // The top-level `compacted` record yields the single context_compact; the
    // event_msg.context_compacted twin emits nothing.
    const compacts = all.filter((e) => e.type === "context_compact");
    expect(compacts).toHaveLength(1);
    expect((compacts[0]?.payload as { summary?: string }).summary).toBe("summary of earlier turns");
  });
});

describe("codex capability registry events", () => {
  test("session dynamic_tools emits a tool snapshot without schemas", async () => {
    const all = await capabilityEntries();
    expectWriterStrict(all);
    const snapshot = all.find(
      (entry) =>
        entry.type === "capability_change" &&
        (entry.payload as { scope?: string; reason?: string }).scope === "tool" &&
        (entry.payload as { scope?: string; reason?: string }).reason === "loaded",
    );
    expect(snapshot?.payload).toEqual({
      scope: "tool",
      reason: "loaded",
      snapshot: [
        {
          name: "search_web",
          metadata: {
            namespace: "web",
            description: "Search the web",
            defer_loading: true,
          },
        },
        {
          name: "request_user_input",
          metadata: {
            description: "Ask the user",
          },
        },
      ],
    });
  });

  test("mcp startup update and complete emit mcp_server capability changes", async () => {
    const all = await capabilityEntries();
    const changes = all
      .filter(
        (entry) =>
          entry.type === "capability_change" &&
          (entry.payload as { scope?: string }).scope === "mcp_server",
      )
      .map((entry) => entry.payload);
    expect(changes).toEqual([
      { scope: "mcp_server", reason: "loaded", added: [{ name: "linear" }] },
      { scope: "mcp_server", reason: "connected", added: [{ name: "linear" }] },
      { scope: "mcp_server", reason: "connected", added: [{ name: "linear" }] },
      {
        scope: "mcp_server",
        reason: "error",
        changed: [{ name: "github", field: "error", to: "auth failed" }],
      },
      { scope: "mcp_server", reason: "disconnected", removed: [{ name: "context7" }] },
    ]);
  });
});

describe("codex v0.135 image-bearing response_item.message", () => {
  const imageEntries = (): Promise<Entry[]> =>
    parseCodexEntries(join(FIXTURES, "image-message.jsonl"), "unit-test");

  test("image is attached to the matching user_message (no duplicate, no carrier leak)", async () => {
    const all = await imageEntries();
    expectWriterStrict(all);
    const users = all.filter((e) => e.type === "user_message");
    // Exactly one user_message (the event_msg echo) — the image-bearing
    // response_item.message does NOT add a second message.
    expect(users).toHaveLength(1);
    expect((users[0]?.payload as { text?: string }).text).toBe("describe this screenshot");
    expect((users[0]?.payload as { attachments?: unknown }).attachments).toEqual([
      {
        kind: "image",
        media_type: "image/png",
        uri: PNG_SHA256,
      },
    ]);
    // the transient carrier never reaches the output
    expect(
      all.some((e) => (e.meta as Record<string, unknown> | undefined)?.["x-codex/_images"]),
    ).toBe(false);
    expect(all.filter((e) => e.type === "agent_message")).toHaveLength(1);
  });

  test("unmatched image carrier falls back to a valid standalone message", async () => {
    const all = await parseCodexEntries(
      join(FIXTURES, "image-message-unmatched.jsonl"),
      "unit-test",
    );
    expectWriterStrict(all);
    expect(all).toHaveLength(2);
    expect(all[0]?.type).toBe("user_message");
    expect((all[0]?.payload as { text?: string }).text).toBe("orphan\n  image");
    expect((all[0]?.payload as { attachments?: unknown }).attachments).toEqual([
      {
        kind: "image",
        media_type: "image/png",
        uri: PNG_SHA256,
      },
    ]);
    expect(all[0]?.source?.original_type).toBe("response_item.message");
    expect((all[0]?.meta as Record<string, unknown> | undefined)?.["x-codex/_images"]).toBe(
      undefined,
    );
    expect(all[1]?.type).toBe("agent_message");
    expect((all[1]?.payload as { text?: string }).text).toBe("later reply");
  });

  test("image rollup binds repeated text to the nearest matching message", async () => {
    const all = await parseCodexEntries(
      join(FIXTURES, "image-message-repeated-text.jsonl"),
      "unit-test",
    );
    expectWriterStrict(all);
    const users = all.filter((e) => e.type === "user_message");
    expect(users).toHaveLength(2);
    expect((users[0]?.payload as { attachments?: unknown }).attachments).toBeUndefined();
    expect((users[1]?.payload as { attachments?: unknown }).attachments).toEqual([
      {
        kind: "image",
        media_type: "image/png",
        uri: PNG_SHA256,
      },
    ]);
  });

  test("source.data image blocks hash into schema-valid attachments", async () => {
    const all = await parseCodexEntries(
      join(FIXTURES, "image-message-source-data.jsonl"),
      "unit-test",
    );
    expectWriterStrict(all);
    const users = all.filter((e) => e.type === "user_message");
    expect(users).toHaveLength(1);
    expect((users[0]?.payload as { text?: string }).text).toBe("source image");
    expect((users[0]?.payload as { attachments?: unknown }).attachments).toEqual([
      {
        kind: "image",
        media_type: "image/png",
        uri: PNG_SHA256,
      },
    ]);
  });

  test("oversized inline images do not decode into attachment URIs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-trail-codex-images-"));
    const path = join(dir, "oversized-image.jsonl");
    const encodedBytesOverCap = Math.ceil((INLINE_IMAGE_MAX_DECODED_BYTES + 1) / 3) * 4;
    const oversizedBase64 = "A".repeat(encodedBytesOverCap);
    await writeFile(
      path,
      [
        '{"timestamp":"2026-06-01T11:40:00.000Z","type":"session_meta","payload":{"id":"019d8900-cccc-7000-e000-0000000000bf","cli_version":"0.135.0"}}',
        `{"timestamp":"2026-06-01T11:40:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"big image"}}`,
        `{"timestamp":"2026-06-01T11:40:02.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"big image"},{"type":"input_image","detail":"auto","image_url":"data:image/png;base64,${oversizedBase64}"}]}}`,
      ].join("\n"),
    );
    try {
      const all = await parseCodexEntries(path, "unit-test");
      expectWriterStrict(all);
      const user = all.find((e) => e.type === "user_message");
      expect((user?.payload as { attachments?: unknown }).attachments).toEqual([
        {
          kind: "image",
          media_type: "image/png",
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
