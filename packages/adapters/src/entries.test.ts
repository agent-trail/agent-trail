import { expect, test } from "bun:test";
import { createSourceFor } from "./entries.ts";

type Env = { id: string };
type Block = { type: string; text: string };

const sourceFor = createSourceFor<Env, Block>({
  agent: "claude_code",
  resolveSchemaVersion: () => undefined,
});

test("envelopeRef path enforces source.raw size cap on the inlined block", () => {
  const env: Env = { id: "env-1" };
  const block: Block = { type: "text", text: "x".repeat(50_000) };
  const source = sourceFor(env, "text", block, 0, { envelopeRef: "src-0" });
  // Without enforcement the redacted block would blow past the default cap.
  // After enforcement the oversized block leaf is replaced with the elide
  // marker but envelope_ref/block_index are preserved.
  expect(source.raw?.envelope_ref).toBe("src-0");
  expect(source.raw?.block_index).toBe(0);
  expect(source.raw?.block).toEqual({
    type: "text",
    text: { elided: true, size_bytes: Buffer.byteLength("x".repeat(50_000), "utf8") },
  });
});

test("envelopeRef path leaves small blocks verbatim", () => {
  const env: Env = { id: "env-1" };
  const block: Block = { type: "text", text: "hello" };
  const source = sourceFor(env, "text", block, 2, { envelopeRef: "src-0" });
  expect(source.raw).toEqual({
    envelope_ref: "src-0",
    block: { type: "text", text: "hello" },
    block_index: 2,
  });
});
