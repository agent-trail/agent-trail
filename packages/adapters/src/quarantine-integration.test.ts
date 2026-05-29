import { describe, expect, test } from "bun:test";
import type { Entry } from "@agent-trail/types";
import { parseClaudeCodeJsonl } from "./claude-code/parser.ts";
import { parseCodexJsonl } from "./codex/parser.ts";
import { parsePiJsonl } from "./pi/parser.ts";

function unknownRecordEntries(entries: Entry[]): Entry[] {
  return entries.filter(
    (e) =>
      e.type === "system_event" &&
      typeof (e.payload as { kind?: unknown }).kind === "string" &&
      (e.payload as { kind: string }).kind.endsWith("/unknown_record"),
  );
}

describe("source-schema drift quarantine", () => {
  test("codex: an unknown event_msg subtype becomes one x-codex/unknown_record entry", () => {
    const text = `${[
      {
        timestamp: "2026-05-28T11:00:00.000Z",
        type: "session_meta",
        payload: { id: "019d8900-aaaa-7000-e000-0000000000ff", cli_version: "0.128.0" },
      },
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "hi" },
      },
      {
        timestamp: "2026-05-28T11:00:02.000Z",
        type: "event_msg",
        payload: { type: "brand_new_subtype", foo: 1 },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n")}\n`;

    const { entries } = parseCodexJsonl(text);
    const quarantined = unknownRecordEntries(entries);
    expect(quarantined).toHaveLength(1);
    expect((quarantined[0]?.payload as { kind: string }).kind).toBe("x-codex/unknown_record");
    expect((quarantined[0]?.payload as { data: { raw: { type: string } } }).data.raw.type).toBe(
      "event_msg",
    );
    expect(quarantined[0]?.source?.synthesized).toBe(true);
    expect(quarantined[0]?.source?.original_type).toBe("event_msg");
    // Known user_message still emitted.
    expect(entries.some((e) => e.type === "user_message")).toBe(true);
  });

  test("pi: an unknown top-level type becomes one x-pi/unknown_record entry", () => {
    const text = `${[
      {
        type: "session",
        version: 3,
        id: "00000000-0000-0000-0000-0000000000a1",
        timestamp: "2026-05-21T14:00:00.000Z",
      },
      {
        type: "message",
        id: "00000000-0000-0000-0000-0000000000a2",
        parentId: null,
        timestamp: "2026-05-21T14:00:01.000Z",
        message: { role: "user", content: "go" },
      },
      {
        type: "unknown_future_envelope",
        id: "00000000-0000-0000-0000-0000000000a3",
        parentId: "00000000-0000-0000-0000-0000000000a2",
        timestamp: "2026-05-21T14:00:02.000Z",
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n")}\n`;

    const { entries } = parsePiJsonl(text);
    const quarantined = unknownRecordEntries(entries);
    expect(quarantined).toHaveLength(1);
    expect((quarantined[0]?.payload as { kind: string }).kind).toBe("x-pi/unknown_record");
  });

  test("claude-code: an unknown top-level type becomes one x-claudecode/unknown_record entry", () => {
    const text = `${[
      {
        type: "user",
        uuid: "00000000-0000-0000-0000-0000000000b1",
        parentUuid: null,
        timestamp: "2026-05-17T14:00:00.000Z",
        sessionId: "00000000-0000-0000-0000-0000000000b0",
        version: "1.0.0-synthetic",
        message: { role: "user", content: "hi" },
      },
      {
        type: "totally_unknown",
        uuid: "00000000-0000-0000-0000-0000000000b2",
        parentUuid: "00000000-0000-0000-0000-0000000000b1",
        timestamp: "2026-05-17T14:00:01.000Z",
        sessionId: "00000000-0000-0000-0000-0000000000b0",
        version: "1.0.0-synthetic",
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n")}\n`;

    const { entries } = parseClaudeCodeJsonl(text);
    const quarantined = unknownRecordEntries(entries);
    expect(quarantined).toHaveLength(1);
    expect((quarantined[0]?.payload as { kind: string }).kind).toBe("x-claudecode/unknown_record");
  });

  test("codex: a tsless unknown record still quarantines using the inherited ts", () => {
    const text = `${[
      {
        timestamp: "2026-05-28T11:00:00.000Z",
        type: "session_meta",
        payload: { id: "019d8900-aaaa-7000-e000-0000000000ff", cli_version: "0.128.0" },
      },
      // No timestamp on the drifting record — must fall back, not vanish.
      { type: "event_msg", payload: { type: "brand_new_subtype", foo: 1 } },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n")}\n`;

    const { entries } = parseCodexJsonl(text);
    const quarantined = unknownRecordEntries(entries);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.ts).toBe("2026-05-28T11:00:00.000Z");
  });

  test("codex: a fully valid session emits no quarantine entries", () => {
    const text = `${[
      {
        timestamp: "2026-05-28T11:00:00.000Z",
        type: "session_meta",
        payload: { id: "019d8900-aaaa-7000-e000-0000000000ff", cli_version: "0.128.0" },
      },
      {
        timestamp: "2026-05-28T11:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "hi" },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n")}\n`;

    const { entries } = parseCodexJsonl(text);
    expect(unknownRecordEntries(entries)).toHaveLength(0);
  });

  test("codex: an undefined schema version skips validation, so nothing quarantines", () => {
    const text = `${[
      // No cli_version → selectSchemaVersion returns undefined → validation is
      // skipped entirely, so the unknown subtype is not quarantined.
      {
        timestamp: "2026-05-28T11:00:00.000Z",
        type: "session_meta",
        payload: { id: "019d8900-aaaa-7000-e000-0000000000ff" },
      },
      {
        timestamp: "2026-05-28T11:00:02.000Z",
        type: "event_msg",
        payload: { type: "brand_new_subtype", foo: 1 },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n")}\n`;

    const { entries } = parseCodexJsonl(text);
    expect(unknownRecordEntries(entries)).toHaveLength(0);
  });

  test("codex and pi quarantine namespaces stay distinct", () => {
    const codexText = `${[
      {
        timestamp: "2026-05-28T11:00:00.000Z",
        type: "session_meta",
        payload: { id: "019d8900-aaaa-7000-e000-0000000000ff", cli_version: "0.128.0" },
      },
      {
        timestamp: "2026-05-28T11:00:02.000Z",
        type: "event_msg",
        payload: { type: "brand_new_subtype", foo: 1 },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n")}\n`;
    const piText = `${[
      {
        type: "session",
        version: 3,
        id: "00000000-0000-0000-0000-0000000000a1",
        timestamp: "2026-05-21T14:00:00.000Z",
      },
      {
        type: "unknown_future_envelope",
        id: "00000000-0000-0000-0000-0000000000a3",
        parentId: null,
        timestamp: "2026-05-21T14:00:02.000Z",
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n")}\n`;

    const codexKind = (
      unknownRecordEntries(parseCodexJsonl(codexText).entries)[0]?.payload as { kind: string }
    ).kind;
    const piKind = (
      unknownRecordEntries(parsePiJsonl(piText).entries)[0]?.payload as { kind: string }
    ).kind;
    expect(codexKind).toBe("x-codex/unknown_record");
    expect(piKind).toBe("x-pi/unknown_record");
    expect(codexKind).not.toBe(piKind);
  });
});
