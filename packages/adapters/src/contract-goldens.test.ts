import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateTrailString } from "@agent-trail/core";
import {
  claudeCodeAdapter,
  codexAdapter,
  piAdapter,
  type TrailAdapter,
  trailRecords,
} from "./index.ts";

const FIXTURES_DIR = new URL("../tests/fixtures/contracts/", import.meta.url);
const REAL_SESSIONS_DIR = new URL("../tests/fixtures/real-sessions/", import.meta.url);
const NORMALIZED_TRAIL_ID = "00000000-0000-4000-8000-000000000000";
const NORMALIZED_TRAIL_TS = "2000-01-01T00:00:00.000Z";
const SECRET_OR_LOCAL_PATH =
  /\/Users\/[^/"\s]+|\/home\/[^/"\s]+|\/private\/tmp\/[^/"\s]+|[A-Za-z]:\\Users\\[^\\/"\s]+|Bearer\s+[A-Za-z0-9_.-]{12,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|BEGIN [A-Z ]*PRIVATE KEY/;

type ContractFixture = {
  key: string;
  adapter: TrailAdapter;
  dir?: URL;
};

const CONTRACT_FIXTURES: ContractFixture[] = [
  { key: "codex-refactor-contract", adapter: codexAdapter },
  { key: "claude-code-v1", adapter: claudeCodeAdapter, dir: REAL_SESSIONS_DIR },
  { key: "pi-v1", adapter: piAdapter, dir: REAL_SESSIONS_DIR },
];

test("contract fixtures have source and expected trail files", async () => {
  const files = (await readdir(FIXTURES_DIR)).filter((name) => name.endsWith(".jsonl")).sort();

  expect(files).toEqual([
    "codex-refactor-contract.source.jsonl",
    "codex-refactor-contract.trail.jsonl",
  ]);
  for (const fixture of CONTRACT_FIXTURES) {
    const dir = fixture.dir ?? FIXTURES_DIR;
    expect(await Bun.file(new URL(`${fixture.key}.source.jsonl`, dir)).exists()).toBe(true);
    expect(await Bun.file(new URL(`${fixture.key}.trail.jsonl`, dir)).exists()).toBe(true);
  }
});

for (const fixture of CONTRACT_FIXTURES) {
  test(`contract golden ${fixture.key} emits exact trail output`, async () => {
    const dir = fixture.dir ?? FIXTURES_DIR;
    const sourceUrl = new URL(`${fixture.key}.source.jsonl`, dir);
    const expectedUrl = new URL(`${fixture.key}.trail.jsonl`, dir);
    const sourceText = await Bun.file(sourceUrl).text();
    const expectedText = await Bun.file(expectedUrl).text();

    expect(sourceText).not.toMatch(SECRET_OR_LOCAL_PATH);
    expect(expectedText).not.toMatch(SECRET_OR_LOCAL_PATH);

    const trail = await fixture.adapter.parseSession({
      id: fixture.key,
      adapter: fixture.adapter.name,
      path: fileURLToPath(sourceUrl),
    });
    const actualText = jsonl(normalizeEnvelope(trailRecords(trail)));

    expect(actualText).toBe(expectedText);
    expect((await validateTrailString(actualText)).filter((d) => d.severity === "error")).toEqual(
      [],
    );
  });
}

function normalizeEnvelope(records: object[]): object[] {
  const normalized = structuredClone(records) as Record<string, unknown>[];
  const first = normalized[0];
  if (first?.type === "trail") {
    first.id = NORMALIZED_TRAIL_ID;
    first.ts = NORMALIZED_TRAIL_TS;
  }
  return normalized;
}

function jsonl(records: object[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}
