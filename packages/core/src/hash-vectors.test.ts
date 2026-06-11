import { expect, test } from "bun:test";
import manifest from "../../../tests/fixtures/validation/manifest.json" with { type: "json" };
import {
  canonicalizeRecords,
  parseJsonlString,
  splitSessionGroups,
  verifyAllSessionContentHashes,
  verifyTrailEnvelopeContentHash,
} from "./index.ts";

type HashExpectation = {
  session_hashes?: string[];
  file_hash?: string;
};

type ManifestFixture = {
  path: string;
  comment?: string;
  expected?: HashExpectation;
};

const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const ORACLE_COMMENT =
  "Oracle: Go github.com/cyberphone/json-canonicalization v0.0.0-20241213102144-19d51d7fe467 + crypto/sha256";
const HASH_VECTOR_PATHS = [
  "hash-vectors/envelope-two-tier.trail.jsonl",
  "hash-vectors/jcs-stress.trail.jsonl",
  "hash-vectors/minimal-pending-roundtrip.trail.jsonl",
  "hash-vectors/multi-session-slice.trail.jsonl",
  "hash-vectors/replacement-char.trail.jsonl",
  "hash-vectors/segment-chain-seq1.trail.jsonl",
  "hash-vectors/segment-chain-seq2.trail.jsonl",
];

const hashVectorFixtures = (manifest as { fixtures: ManifestFixture[] }).fixtures.filter(
  (fixture) => fixture.path.startsWith("hash-vectors/"),
);

const loadFixture = (rel: string) => Bun.file(new URL(rel, FIXTURES)).text();

test("hash vector manifest entries carry oracle expectations", () => {
  expect(hashVectorFixtures.map((fixture) => fixture.path).sort()).toEqual(HASH_VECTOR_PATHS);
  for (const fixture of hashVectorFixtures) {
    expect(fixture.comment).toBe(ORACLE_COMMENT);
    expect(fixture.expected?.session_hashes ?? fixture.expected?.file_hash).toBeDefined();
  }
});

for (const fixture of hashVectorFixtures) {
  test(`${fixture.path} matches manifest hash expectations`, async () => {
    const records = await parseJsonlString(await loadFixture(fixture.path));
    const expected = fixture.expected ?? {};

    if (expected.session_hashes !== undefined) {
      const results = verifyAllSessionContentHashes(records);
      expect(results.map((result) => result.status)).toEqual(
        expected.session_hashes.map(() => "match"),
      );
      expect(results.map((result) => result.expected)).toEqual(expected.session_hashes);
      expect(results.map((result) => result.actual)).toEqual(expected.session_hashes);
    }

    if (expected.file_hash !== undefined) {
      expect(verifyTrailEnvelopeContentHash(records)).toEqual({
        status: "match",
        expected: expected.file_hash,
        actual: expected.file_hash,
      });
    }
  });
}

test("multi-session slice vector preserves per-group content hashes when extracted", async () => {
  const fixture = hashVectorFixtures.find(
    (candidate) => candidate.path === "hash-vectors/multi-session-slice.trail.jsonl",
  );
  expect(fixture?.expected?.session_hashes).toBeDefined();
  const records = await parseJsonlString(await loadFixture(fixture?.path ?? ""));
  const groups = splitSessionGroups(records).groups;

  expect(groups).toHaveLength(fixture?.expected?.session_hashes?.length ?? 0);
  for (const [index, group] of groups.entries()) {
    const extractedRecords = await parseJsonlString(
      canonicalizeRecords([group.header, ...group.entries]),
    );
    const [result] = verifyAllSessionContentHashes(extractedRecords);
    expect(result?.status).toBe("match");
    expect(result?.expected).toBe(fixture?.expected?.session_hashes?.[index]);
    expect(result?.actual).toBe(fixture?.expected?.session_hashes?.[index]);
  }
});

test("segment chain vector links seq-2 to seq-1 session content hash", async () => {
  const seq1 = hashVectorFixtures.find(
    (candidate) => candidate.path === "hash-vectors/segment-chain-seq1.trail.jsonl",
  );
  const seq2 = hashVectorFixtures.find(
    (candidate) => candidate.path === "hash-vectors/segment-chain-seq2.trail.jsonl",
  );
  expect(seq1?.expected?.session_hashes?.[0]).toBeDefined();
  const seq2Records = await parseJsonlString(await loadFixture(seq2?.path ?? ""));
  const [seq2Header] = splitSessionGroups(seq2Records).groups;
  const segment = seq2Header?.header.value.segment as { prev_content_hash?: string } | undefined;

  expect(segment?.prev_content_hash).toBe(seq1?.expected?.session_hashes?.[0]);
});

test("one-byte hash vector corruption is detected", async () => {
  for (const fixture of hashVectorFixtures) {
    const text = await loadFixture(fixture.path);
    const corrupted = text.replace(/"id":"[^"]+"/, '"id":"01HXHASHVECTORCORRUPTION0000"');
    expect(corrupted).not.toBe(text);
    const records = await parseJsonlString(corrupted);
    const sessionResults = verifyAllSessionContentHashes(records);
    const envelopeResult = verifyTrailEnvelopeContentHash(records);
    const statuses = [...sessionResults.map((result) => result.status), envelopeResult.status];

    expect(statuses).toContain("mismatch");
  }
});
