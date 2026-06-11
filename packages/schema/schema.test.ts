import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import defaultSchema from "@agent-trail/schema" with { type: "json" };
import conformanceManifest from "@agent-trail/schema/conformance/manifest.json" with {
  type: "json",
};
import conformanceManifestSchema from "@agent-trail/schema/conformance/manifest.schema.json" with {
  type: "json",
};
import latestSchema from "@agent-trail/schema/latest" with { type: "json" };
import v010Schema from "@agent-trail/schema/v0.1.0" with { type: "json" };

const rootSchema = JSON.parse(
  await readFile(new URL("../../schema.json", import.meta.url), "utf8"),
);
const packagedSchema = JSON.parse(
  await readFile(new URL("./schema.json", import.meta.url), "utf8"),
);
const rootConformanceManifest = JSON.parse(
  await readFile(new URL("../../tests/fixtures/validation/manifest.json", import.meta.url), "utf8"),
);
const packagedConformanceManifest = JSON.parse(
  await readFile(new URL("./conformance/manifest.json", import.meta.url), "utf8"),
);
const rootConformanceManifestSchema = JSON.parse(
  await readFile(
    new URL("../../tests/fixtures/validation/manifest.schema.json", import.meta.url),
    "utf8",
  ),
);
const packagedConformanceManifestSchema = JSON.parse(
  await readFile(new URL("./conformance/manifest.schema.json", import.meta.url), "utf8"),
);
const resolvedMinimalFixture = import.meta.resolve(
  "@agent-trail/schema/conformance/fixtures/valid/minimal-linear.trail.jsonl",
);

test("packaged schema is copied exactly from the canonical root schema", () => {
  expect(packagedSchema).toEqual(rootSchema);
});

test("default export exposes the canonical schema", () => {
  expect(defaultSchema).toEqual(rootSchema);
});

test("latest export exposes the canonical schema", () => {
  expect(latestSchema).toEqual(rootSchema);
});

test("v0.1.0 export exposes the canonical schema", () => {
  expect(v010Schema).toEqual(rootSchema);
});

test("packaged conformance manifest is copied exactly from the canonical fixture manifest", () => {
  expect(packagedConformanceManifest).toEqual(rootConformanceManifest);
});

test("packaged conformance manifest schema is copied exactly from the canonical fixture manifest schema", () => {
  expect(packagedConformanceManifestSchema).toEqual(rootConformanceManifestSchema);
});

test("conformance exports expose the canonical package artifacts", () => {
  expect(conformanceManifest).toEqual(rootConformanceManifest);
  expect(conformanceManifestSchema).toEqual(rootConformanceManifestSchema);
  expect(fileURLToPath(resolvedMinimalFixture)).toEndWith(
    "packages/schema/conformance/fixtures/valid/minimal-linear.trail.jsonl",
  );
});

test("exported conformance fixtures contain the packaged corpus files", async () => {
  expect(await readFile(new URL(resolvedMinimalFixture), "utf8")).toBe(
    '{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","session_uid":"01HZZZZZZZZZZZZZZZZZZZZZ01","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}\n{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}\n{"type":"agent_message","id":"01HEVTA0000000000000000002","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}\n',
  );
});
