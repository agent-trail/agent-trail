import { expect, test } from "bun:test";
import { validateTrailString } from "./index.ts";

const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const loadFixture = (rel: string) => Bun.file(new URL(rel, FIXTURES)).text();

test("valid/minimal-linear.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/minimal-linear.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/minimal-with-content-hash.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/minimal-with-content-hash.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("valid/linear-with-parent-ids.trail.jsonl validates clean", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("valid/linear-with-parent-ids.trail.jsonl"),
  );
  expect(diagnostics).toEqual([]);
});

test("invalid-schema/header-wrong-schema-version.trail.jsonl reports const + missing_header", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/header-wrong-schema-version.trail.jsonl"),
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/schema_version",
      severity: "error",
      code: "const",
      message: "must be equal to constant",
    },
    {
      line: 1,
      path: "",
      severity: "error",
      code: "missing_header",
      message: 'First line must be a session header with type "session" and schema_version "0.1.0"',
    },
  ]);
});

test("invalid-schema/user-message-missing-text.trail.jsonl reports required /payload/text", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/user-message-missing-text.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "required",
    message: "must have required property 'text'",
  });
});

test("invalid-schema/tool-call-missing-args-path.trail.jsonl reports required /payload/args/path", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/tool-call-missing-args-path.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/args/path",
    severity: "error",
    code: "required",
    message: "must have required property 'path'",
  });
});

test("invalid-schema/user-message-non-string-text.trail.jsonl reports type at /payload/text", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-schema/user-message-non-string-text.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "type",
    message: "must be string",
  });
});

test("invalid-graph/duplicate-id.trail.jsonl reports duplicate_id at /id line 3", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/duplicate-id.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 3,
    path: "/id",
    severity: "error",
    code: "duplicate_id",
    message: 'Duplicate id "evta1"; first seen on line 2',
  });
});

test("invalid-graph/unknown-parent-id.trail.jsonl reports unknown_parent_id", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/unknown-parent-id.trail.jsonl"),
  );
  expect(diagnostics).toContainEqual({
    line: 2,
    path: "/parent_id",
    severity: "error",
    code: "unknown_parent_id",
    message: 'parent_id "ghost" does not reference an id in this file',
  });
});

test("invalid-graph/parent-cycle.trail.jsonl reports parent_cycle on both lines", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/parent-cycle.trail.jsonl"),
  );
  const cycles = diagnostics.filter((d) => d.code === "parent_cycle");
  expect(cycles.map((d) => d.line)).toEqual([2, 3]);
});

test("invalid-graph/header-has-parent-id.trail.jsonl reports additionalProperties + header_has_parent_id", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("invalid-graph/header-has-parent-id.trail.jsonl"),
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/parent_id",
      severity: "error",
      code: "additionalProperties",
      message: "must NOT have additional properties",
    },
    {
      line: 1,
      path: "/parent_id",
      severity: "error",
      code: "header_has_parent_id",
      message: "Session header must not have a parent_id",
    },
  ]);
});

test("hash-mismatch/content-hash-mismatch.trail.jsonl reports content_hash_mismatch (strict error)", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("hash-mismatch/content-hash-mismatch.trail.jsonl"),
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "content_hash_mismatch",
      message:
        "content_hash does not match canonical bytes (computed 3936b470a29cb8e6814158eefb2d03871f4f96df480488b761b373b85ef594d2)",
    },
  ]);
});

test("hash-mismatch/content-hash-mismatch.trail.jsonl downgrades to warning under reader-tolerant", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("hash-mismatch/content-hash-mismatch.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "warning",
      code: "content_hash_mismatch",
      message:
        "content_hash does not match canonical bytes (computed 3936b470a29cb8e6814158eefb2d03871f4f96df480488b761b373b85ef594d2)",
    },
  ]);
});

test("hash-mismatch/content-hash-invalid-hex.trail.jsonl reports schema oneOf errors + content_hash_invalid", async () => {
  const diagnostics = await validateTrailString(
    await loadFixture("hash-mismatch/content-hash-invalid-hex.trail.jsonl"),
  );
  expect(diagnostics).toEqual([
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "pattern",
      message: 'must match pattern "^[a-f0-9]{64}$"',
    },
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "const",
      message: "must be equal to constant",
    },
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "oneOf",
      message: "must match exactly one schema in oneOf",
    },
    {
      line: 1,
      path: "/content_hash",
      severity: "error",
      code: "content_hash_invalid",
      message: "content_hash must be 64 lowercase hex characters",
    },
  ]);
});

test("reader-tolerant/patch-compatible-schema-version: strict errors, tolerant warns", async () => {
  const text = await loadFixture("reader-tolerant/patch-compatible-schema-version.trail.jsonl");

  const strict = await validateTrailString(text);
  expect(strict.some((d) => d.code === "const" && d.path === "/schema_version")).toBe(true);

  const tolerant = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerant).toEqual([
    {
      line: 1,
      path: "/schema_version",
      severity: "warning",
      code: "reader_tolerant_schema_version",
      message: 'schema_version "0.1.1" accepted by reader-tolerant patch compatibility',
    },
  ]);
});

test("reader-tolerant/unknown-payload-field: strict errors, tolerant warns", async () => {
  const text = await loadFixture("reader-tolerant/unknown-payload-field.trail.jsonl");

  const strict = await validateTrailString(text);
  expect(strict).toContainEqual({
    line: 2,
    path: "/payload/future_field",
    severity: "error",
    code: "additionalProperties",
    message: "must NOT have additional properties",
  });

  const tolerant = await validateTrailString(text, { profile: "reader-tolerant" });
  expect(tolerant).toContainEqual({
    line: 2,
    path: "/payload/future_field",
    severity: "warning",
    code: "reader_tolerant_unknown_payload_field",
    message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
  });
  expect(tolerant.some((d) => d.severity === "error")).toBe(false);
});

test("reader-tolerant/nested-unknown-payload-field warns at nested path", async () => {
  const tolerant = await validateTrailString(
    await loadFixture("reader-tolerant/nested-unknown-payload-field.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/payload/attachments/0/future_field",
      severity: "warning",
      code: "reader_tolerant_unknown_payload_field",
      message: 'Unknown payload field "future_field" preserved for reader-tolerant parsing',
    },
  ]);
});

test("reader-tolerant/unknown-event-type preserves unknown record with warning", async () => {
  const tolerant = await validateTrailString(
    await loadFixture("reader-tolerant/unknown-event-type.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/type",
      severity: "warning",
      code: "reader_tolerant_unknown_record",
      message: 'Unknown event type "future_event" preserved for reader-tolerant parsing',
    },
  ]);
});

test("reader-tolerant/reserved-future-event-type preserves reserved type with warning", async () => {
  const tolerant = await validateTrailString(
    await loadFixture("reader-tolerant/reserved-future-event-type.trail.jsonl"),
    { profile: "reader-tolerant" },
  );
  expect(tolerant).toEqual([
    {
      line: 2,
      path: "/type",
      severity: "warning",
      code: "reader_tolerant_unknown_record",
      message: 'Unknown event type "error" preserved for reader-tolerant parsing',
    },
  ]);
});
