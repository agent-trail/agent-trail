import { expect, test } from "bun:test";
import { isObject, jsonObjectValue, stringValue } from "../index.ts";

test("isObject: plain objects and arrays are objects", () => {
  expect(isObject({})).toBe(true);
  expect(isObject({ a: 1 })).toBe(true);
  expect(isObject([])).toBe(true);
});

test("isObject: null and primitives are not objects", () => {
  expect(isObject(null)).toBe(false);
  expect(isObject(undefined)).toBe(false);
  expect(isObject("x")).toBe(false);
  expect(isObject(1)).toBe(false);
});

test("stringValue: returns strings, undefined otherwise", () => {
  expect(stringValue("hi")).toBe("hi");
  expect(stringValue("")).toBe("");
  expect(stringValue(1)).toBeUndefined();
  expect(stringValue(null)).toBeUndefined();
  expect(stringValue({})).toBeUndefined();
});

test("jsonObjectValue: returns objects/arrays, undefined for non-objects", () => {
  const obj = { a: 1 };
  expect(jsonObjectValue(obj)).toBe(obj);
  const arr: unknown = [];
  expect(jsonObjectValue(arr)).toBe(arr as Record<string, unknown>);
  expect(jsonObjectValue(null)).toBeUndefined();
  expect(jsonObjectValue("x")).toBeUndefined();
});
