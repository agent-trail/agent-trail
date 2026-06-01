import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Entry } from "@agent-trail/types";
import { parseCodexEntries } from "./kit.ts";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/codex");
const entries = (): Promise<Entry[]> =>
  parseCodexEntries(join(FIXTURES, "v0_135-events.jsonl"), "unit-test");

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
  });

  test("item_completed (Plan) → system_event preserving the item", async () => {
    const all = await entries();
    const planEvents = all.filter(
      (e) =>
        e.type === "system_event" &&
        (e.payload as { kind?: string }).kind === "x-codex/item_completed",
    );
    expect(planEvents).toHaveLength(1);
    const data = (planEvents[0]?.payload as { data?: { item?: { type?: string } } }).data;
    expect(data?.item?.type).toBe("Plan");
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

describe("codex v0.135 image-bearing response_item.message", () => {
  const imageEntries = (): Promise<Entry[]> =>
    parseCodexEntries(join(FIXTURES, "image-message.jsonl"), "unit-test");

  test("image is attached to the matching user_message (no duplicate, no carrier leak)", async () => {
    const all = await imageEntries();
    const users = all.filter((e) => e.type === "user_message");
    // Exactly one user_message (the event_msg echo) — the image-bearing
    // response_item.message does NOT add a second message.
    expect(users).toHaveLength(1);
    expect((users[0]?.payload as { text?: string }).text).toBe("describe this screenshot");
    expect((users[0]?.payload as { attachments?: unknown }).attachments).toEqual([
      {
        kind: "image",
        media_type: "image/png",
        uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      },
    ]);
    // the transient carrier never reaches the output
    expect(
      all.some((e) => (e.meta as Record<string, unknown> | undefined)?.["x-codex/_images"]),
    ).toBe(false);
    expect(all.filter((e) => e.type === "agent_message")).toHaveLength(1);
  });
});
