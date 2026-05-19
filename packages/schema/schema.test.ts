import { readFile } from "node:fs/promises";
import { expect, test } from "bun:test";

import defaultSchema from "@agent-trail/schema" with { type: "json" };
import latestSchema from "@agent-trail/schema/latest" with { type: "json" };
import v010Schema from "@agent-trail/schema/v0.1.0" with { type: "json" };

const rootSchema = JSON.parse(
  await readFile(new URL("../../schema.json", import.meta.url), "utf8"),
);
const packagedSchema = JSON.parse(
  await readFile(new URL("./schema.json", import.meta.url), "utf8"),
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
