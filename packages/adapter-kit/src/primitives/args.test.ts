import { expect, test } from "bun:test";
import { commandFrom, filePathFrom } from "../index.ts";

test("commandFrom: string command", () => {
  expect(commandFrom({ command: "ls -la" })).toBe("ls -la");
});

test("commandFrom: falls back to cmd string when command absent", () => {
  expect(commandFrom({ cmd: "pwd" })).toBe("pwd");
});

test("commandFrom: prefers command over cmd when both present", () => {
  expect(commandFrom({ command: "a", cmd: "b" })).toBe("a");
});

test("commandFrom: argv array is quoted and joined", () => {
  expect(commandFrom({ command: ["bash", "-lc", "echo hi"] })).toBe("bash -lc 'echo hi'");
});

test("commandFrom: refuses argv array containing non-strings", () => {
  expect(commandFrom({ command: ["bash", 3] })).toBeUndefined();
  expect(commandFrom({ command: [] })).toBeUndefined();
});

test("commandFrom: undefined when no recognizable command", () => {
  expect(commandFrom({})).toBeUndefined();
  expect(commandFrom({ command: 5 })).toBeUndefined();
});

test("filePathFrom: prefers file_path then path", () => {
  expect(filePathFrom({ file_path: "/a", path: "/b" })).toBe("/a");
  expect(filePathFrom({ path: "/b" })).toBe("/b");
  expect(filePathFrom({})).toBeUndefined();
});
