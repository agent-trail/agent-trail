import { expect, test } from "bun:test";
import { quoteShellArg } from "../index.ts";

test("quoteShellArg: leaves shell-safe tokens unquoted", () => {
  expect(quoteShellArg("ls")).toBe("ls");
  expect(quoteShellArg("src/index.ts")).toBe("src/index.ts");
  expect(quoteShellArg("a_b-c.d@e:f+g=h")).toBe("a_b-c.d@e:f+g=h");
});

test("quoteShellArg: single-quotes tokens with special chars", () => {
  expect(quoteShellArg("a b")).toBe("'a b'");
  expect(quoteShellArg("x;y")).toBe("'x;y'");
});

test("quoteShellArg: escapes embedded single quotes", () => {
  expect(quoteShellArg("it's")).toBe("'it'\\''s'");
});
