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

// Fixtures that deliberately carry a schema-invalid record to exercise the
// drift → quarantine path. Keyed `${agent}/${file}`. These assert the OPPOSITE:
// that at least one record fails validation, so the drift coverage stays real.
const DRIFT_FIXTURES = new Set(["pi/quarantine.jsonl"]);

for (const { agent, version } of corpus) {
  describe(`${agent} ${version} source schema corpus`, () => {
    for (const { file, records } of readFixtureRecords(agent)) {
      const isDriftFixture = DRIFT_FIXTURES.has(`${agent}/${file}`);
      test(`${file} ${isDriftFixture ? "carries the expected drift" : "validates clean"}`, () => {
        const invalid = records.filter(
          (record) => validateSourceRecord(agent, version, record).length > 0,
        );
        if (isDriftFixture) {
          expect(invalid.length).toBeGreaterThan(0);
          return;
        }
        for (const record of records) {
          expect(formatDiagnosticsText(validateSourceRecord(agent, version, record))).toBe("");
        }
      });
    }
  });
}
