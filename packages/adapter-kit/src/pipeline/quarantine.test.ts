import { describe, expect, test } from "bun:test";
import { validateWriterStrictRecord } from "@agent-trail/core";
import { quarantine } from "./quarantine.ts";

describe("quarantine", () => {
  test("wraps an unknown record as a namespaced unknown_record system_event", () => {
    const record = { type: "brand_new_record", payload: { foo: 1 } };
    const entry = quarantine({
      agent: "codex-cli",
      namespace: "codex",
      id: "00000000-0000-0000-0000-000000000001",
      ts: "2026-05-28T11:00:00.000Z",
      record,
    });

    expect(entry.type).toBe("system_event");
    expect((entry.payload as { kind: string }).kind).toBe("x-codex/unknown_record");
    expect((entry.payload as { data: { raw: unknown } }).data.raw).toEqual(record);
    expect(entry.source?.agent).toBe("codex-cli");
    expect(entry.source?.original_type).toBe("brand_new_record");
  });

  test("emitted entry passes core writer-strict validation", () => {
    const entry = quarantine({
      agent: "pi",
      namespace: "pi",
      id: "00000000-0000-0000-0000-000000000002",
      ts: "2026-05-28T11:00:00.000Z",
      record: { type: "mystery", value: 42 },
    });

    const diagnostics = validateWriterStrictRecord({
      line: 2,
      raw: JSON.stringify(entry),
      value: entry as Record<string, unknown>,
    });
    expect(diagnostics).toEqual([]);
  });

  test("omits original_type when record.type is not a string", () => {
    const entry = quarantine({
      agent: "pi",
      namespace: "pi",
      id: "00000000-0000-0000-0000-000000000003",
      ts: "2026-05-28T11:00:00.000Z",
      record: { type: 42, value: "x" },
    });

    expect(entry.source?.original_type).toBeUndefined();
  });

  test("throws when namespace is not lowercase kebab-case", () => {
    expect(() =>
      quarantine({
        agent: "codex-cli",
        namespace: "Codex",
        id: "00000000-0000-0000-0000-000000000004",
        ts: "2026-05-28T11:00:00.000Z",
        record: { type: "mystery" },
      }),
    ).toThrow(/namespace must match/);
  });
});
