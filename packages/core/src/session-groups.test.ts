import { describe, expect, test } from "bun:test";
import { parseJsonlString } from "./jsonl.ts";
import { splitSessionGroups } from "./session-groups.ts";

describe("splitSessionGroups", () => {
  test("single session, no envelope → one group, no envelope, no prelude", async () => {
    const records = await parseJsonlString(
      [
        '{"type":"session","schema_version":"0.1.0","id":"01H000000000000000000000S1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
        '{"type":"user_message","id":"01H000000000000000000000E1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi"}}',
        '{"type":"agent_message","id":"01H000000000000000000000E2","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"yo"}}',
      ].join("\n"),
    );

    const split = splitSessionGroups(records);

    expect(split.envelope).toBeNull();
    expect(split.preludeOrphans).toEqual([]);
    expect(split.malformedHeaderLines).toEqual([]);
    expect(split.groups).toHaveLength(1);
    const [group] = split.groups;
    if (group === undefined) throw new Error("group missing");
    expect(group.header.line).toBe(1);
    expect(group.header.value.id).toBe("01H000000000000000000000S1");
    expect(group.entries).toHaveLength(2);
    expect(group.entries[0]?.value.id).toBe("01H000000000000000000000E1");
    expect(group.entries[1]?.value.id).toBe("01H000000000000000000000E2");
    expect(group.startLine).toBe(1);
    expect(group.endLineExclusive).toBe(4);
  });

  test("envelope + single session → envelope captured, one group from line 2", async () => {
    const records = await parseJsonlString(
      [
        '{"type":"trail","schema_version":"0.1.0","id":"01H000000000000000000000T1","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0"}',
        '{"type":"session","schema_version":"0.1.0","id":"01H000000000000000000000S1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
        '{"type":"user_message","id":"01H000000000000000000000E1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi"}}',
      ].join("\n"),
    );

    const split = splitSessionGroups(records);

    expect(split.envelope?.line).toBe(1);
    expect(split.envelope?.value.type).toBe("trail");
    expect(split.preludeOrphans).toEqual([]);
    expect(split.groups).toHaveLength(1);
    const [group] = split.groups;
    if (group === undefined) throw new Error("group missing");
    expect(group.header.line).toBe(2);
    expect(group.entries).toHaveLength(1);
    expect(group.startLine).toBe(2);
    expect(group.endLineExclusive).toBe(4);
  });

  test("two sessions, no envelope → two groups with correct entry partition", async () => {
    const records = await parseJsonlString(
      [
        '{"type":"session","schema_version":"0.1.0","id":"01H000000000000000000000S1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
        '{"type":"user_message","id":"01H000000000000000000000E1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi"}}',
        '{"type":"agent_message","id":"01H000000000000000000000E2","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"yo"}}',
        '{"type":"session","schema_version":"0.1.0","id":"01H000000000000000000000S2","ts":"2026-05-17T14:05:00.000Z","agent":{"name":"claude-code"}}',
        '{"type":"user_message","id":"01H000000000000000000000E3","ts":"2026-05-17T14:05:05.000Z","payload":{"text":"continue"}}',
      ].join("\n"),
    );

    const split = splitSessionGroups(records);

    expect(split.envelope).toBeNull();
    expect(split.groups).toHaveLength(2);
    const [g1, g2] = split.groups;
    if (g1 === undefined || g2 === undefined) throw new Error("groups missing");
    expect(g1.header.line).toBe(1);
    expect(g1.entries.map((e) => e.value.id)).toEqual([
      "01H000000000000000000000E1",
      "01H000000000000000000000E2",
    ]);
    expect(g1.startLine).toBe(1);
    expect(g1.endLineExclusive).toBe(4);
    expect(g2.header.line).toBe(4);
    expect(g2.entries.map((e) => e.value.id)).toEqual(["01H000000000000000000000E3"]);
    expect(g2.startLine).toBe(4);
    expect(g2.endLineExclusive).toBe(6);
  });

  test("three sessions with envelope → envelope + three groups in file order", async () => {
    const records = await parseJsonlString(
      [
        '{"type":"trail","schema_version":"0.1.0","id":"01H000000000000000000000T1","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0"}',
        '{"type":"session","schema_version":"0.1.0","id":"01H000000000000000000000S1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
        '{"type":"user_message","id":"01H000000000000000000000E1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"a"}}',
        '{"type":"session","schema_version":"0.1.0","id":"01H000000000000000000000S2","ts":"2026-05-17T14:01:00.000Z","agent":{"name":"claude-code"}}',
        '{"type":"user_message","id":"01H000000000000000000000E2","ts":"2026-05-17T14:01:05.000Z","payload":{"text":"b"}}',
        '{"type":"session","schema_version":"0.1.0","id":"01H000000000000000000000S3","ts":"2026-05-17T14:02:00.000Z","agent":{"name":"pi"}}',
      ].join("\n"),
    );

    const split = splitSessionGroups(records);

    expect(split.envelope?.line).toBe(1);
    expect(split.groups.map((g) => g.header.line)).toEqual([2, 4, 6]);
    expect(split.groups.map((g) => g.entries.length)).toEqual([1, 1, 0]);
    expect(split.groups[2]?.endLineExclusive).toBe(7);
  });

  test("orphan prelude → events before first session header captured", async () => {
    const records = await parseJsonlString(
      [
        '{"type":"user_message","id":"01H000000000000000000000E0","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"oops"}}',
        '{"type":"session","schema_version":"0.1.0","id":"01H000000000000000000000S1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}',
        '{"type":"user_message","id":"01H000000000000000000000E1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hi"}}',
      ].join("\n"),
    );

    const split = splitSessionGroups(records);

    expect(split.preludeOrphans).toHaveLength(1);
    expect(split.preludeOrphans[0]?.line).toBe(1);
    expect(split.groups).toHaveLength(1);
    expect(split.groups[0]?.header.line).toBe(2);
  });
});
