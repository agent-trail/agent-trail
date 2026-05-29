import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineAdapter } from "./define-adapter.ts";
import { defineMapping } from "./define-mapping.ts";
import { JsonlReader } from "./readers/jsonl-reader.ts";
import type { RawRecord } from "./readers/types.ts";

const PI_ENTRY_NS = "f9a5cab6-b078-4cde-e267-849a0b1c2d34";
const dir = mkdtempSync(join(tmpdir(), "adapter-kit-e2e-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function fixture(name: string, lines: object[]): string {
  const path = join(dir, name);
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return path;
}

const userMessage = defineMapping<RawRecord>({
  match: { type: "message", message: { role: "user" } },
  emit: (record) => [
    {
      type: "user_message",
      payload: { text: String((record.message as { content: string }).content) },
      parent_id: null,
    },
  ],
});

// One assistant record fans out to a message + a tool_call/tool_result pair
// sharing a linker call_id, exercising tool-linking end-to-end.
const assistantMessage = defineMapping<RawRecord>({
  match: { type: "message", message: { role: "assistant" } },
  emit: () => [
    { type: "agent_message", payload: { text: "Done." } },
    { type: "tool_call", payload: { tool: "shell_command" }, meta: { linker: { call_id: "c1" } } },
    { type: "tool_result", payload: { ok: true }, meta: { linker: { call_id: "c1" } } },
  ],
});

const adapter = defineAdapter({
  agent: "pi",
  idNamespace: PI_ENTRY_NS,
  quarantineNamespace: "pi",
  sourceFormatVersions: ["v1"],
  reader: new JsonlReader({ versionFrom: () => "3.0.0" }),
  tsFrom: (record) => String(record.timestamp),
  mappings: [userMessage, assistantMessage],
  reconciler: { toolLinking: true, parentChain: true },
});

describe("defineAdapter().parse() end-to-end", () => {
  test("maps valid records, links + parents entries, strips meta.linker", async () => {
    const path = fixture("clean.jsonl", [
      {
        type: "session",
        version: 3,
        id: "00000000-0000-0000-0000-eeeee0000099",
        timestamp: "2026-05-21T14:00:00.000Z",
        cwd: "/tmp/p",
      },
      {
        type: "message",
        id: "00000000-0000-0000-0000-eeeeeeeeee11",
        parentId: null,
        timestamp: "2026-05-21T14:00:01.000Z",
        message: { role: "user", content: "hi" },
      },
      {
        type: "message",
        id: "00000000-0000-0000-0000-eeeeeeeeee12",
        parentId: "00000000-0000-0000-0000-eeeeeeeeee11",
        timestamp: "2026-05-21T14:00:02.000Z",
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          stopReason: "stop",
          content: [{ type: "text", text: "Done." }],
        },
      },
    ]);

    const entries = await adapter.parse({ path }, { sessionUid: "sess-1" });

    // session record matched no mapping → dropped; 1 user + 3 from assistant.
    expect(entries.map((e) => e.type)).toEqual([
      "user_message",
      "agent_message",
      "tool_call",
      "tool_result",
    ]);
    // parent chain
    expect(entries[0]?.parent_id).toBeNull();
    expect(entries[1]?.parent_id).toBe(entries[0]?.id);
    // tool linking
    expect((entries[3]?.payload as { for_id?: string }).for_id).toBe(entries[2]?.id);
    expect(entries[3]?.semantic?.call_id).toBe("c1");
    // no transient linker survives
    expect(entries.every((e) => e.meta === undefined || !("linker" in e.meta))).toBe(true);
  });

  test("quarantines records that fail source-schema validation", async () => {
    const path = fixture("drift.jsonl", [
      {
        type: "session",
        version: 3,
        id: "00000000-0000-0000-0000-eeeee0000099",
        timestamp: "2026-05-21T14:00:00.000Z",
        cwd: "/tmp/p",
      },
      { type: "totally_unknown_record", timestamp: "2026-05-21T14:00:05.000Z", blob: { a: 1 } },
    ]);

    const entries = await adapter.parse({ path }, { sessionUid: "sess-2" });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("system_event");
    expect((entries[0]?.payload as { kind: string }).kind).toBe("x-pi/unknown_record");
    expect((entries[0]?.payload as { data: { raw: RawRecord } }).data.raw.type).toBe(
      "totally_unknown_record",
    );
    expect(entries[0]?.source?.synthesized).toBe(true);
  });
});
