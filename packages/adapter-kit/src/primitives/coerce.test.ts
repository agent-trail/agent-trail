import { expect, test } from "bun:test";
import { coerceInt } from "../index.ts";

test("coerceInt: returns finite numbers", () => {
  expect(coerceInt(0)).toBe(0);
  expect(coerceInt(42)).toBe(42);
  expect(coerceInt(-3)).toBe(-3);
  expect(coerceInt(1.5)).toBe(1.5);
});

test("coerceInt: rejects non-finite and non-numbers (strict, no string coercion)", () => {
  expect(coerceInt("12")).toBeUndefined();
  expect(coerceInt(Number.NaN)).toBeUndefined();
  expect(coerceInt(Number.POSITIVE_INFINITY)).toBeUndefined();
  expect(coerceInt(null)).toBeUndefined();
  expect(coerceInt(undefined)).toBeUndefined();
});
