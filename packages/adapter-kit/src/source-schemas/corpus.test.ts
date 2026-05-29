import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatDiagnosticsText } from "@agent-trail/core";
import type { RawRecord } from "../readers/types.ts";
import { validateSourceRecord } from "./validate.ts";

const fixturesRoot = fileURLToPath(new URL("../../../adapters/tests/fixtures/", import.meta.url));

function readFixtureRecords(agent: string): { file: string; records: RawRecord[] }[] {
  const dir = `${fixturesRoot}${agent}/`;
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((file) => ({
      file,
      records: readFileSync(`${dir}${file}`, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as RawRecord),
    }));
}

const corpus: { agent: string; version: string }[] = [
  { agent: "codex", version: "v0.128" },
  { agent: "pi", version: "v1" },
  { agent: "claude-code", version: "v1" },
];

for (const { agent, version } of corpus) {
  describe(`${agent} ${version} source schema corpus`, () => {
    for (const { file, records } of readFixtureRecords(agent)) {
      test(`every record in ${file} validates clean`, () => {
        for (const record of records) {
          const diagnostics = validateSourceRecord(agent, version, record);
          expect(formatDiagnosticsText(diagnostics)).toBe("");
        }
      });
    }
  });
}
