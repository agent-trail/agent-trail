import { expect, test } from "bun:test";
import { parseGistIdFromGhOutput } from "./gist-upload.ts";

test("parseGistIdFromGhOutput: extracts id from typical gh output", () => {
  const stdout = "https://gist.github.com/octocat/abc123\n";
  expect(parseGistIdFromGhOutput(stdout)).toBe("abc123");
});

test("parseGistIdFromGhOutput: extracts id from owner-less gist URL", () => {
  const stdout = "https://gist.github.com/abc123\n";
  expect(parseGistIdFromGhOutput(stdout)).toBe("abc123");
});

test("parseGistIdFromGhOutput: throws on unrecognized output", () => {
  expect(() => parseGistIdFromGhOutput("weird output")).toThrow(
    /gh gist create: unexpected output/,
  );
});
