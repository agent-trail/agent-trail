import { describe, expect, test } from "bun:test";
import { defineMapping } from "./define-mapping.ts";
import { dispatch } from "./dispatch.ts";

describe("dispatch", () => {
  test("selects the mapping whose top-level match equals the record", () => {
    const userMsg = defineMapping({
      match: { type: "user_message" },
      emit: () => [{ type: "user_message" as const }],
    });
    const mappings = [userMsg];

    expect(dispatch({ type: "user_message", text: "hi" }, mappings)).toBe(userMsg);
  });

  test("returns undefined when no mapping matches", () => {
    const userMsg = defineMapping({
      match: { type: "user_message" },
      emit: () => [{ type: "user_message" as const }],
    });

    expect(dispatch({ type: "tool_call" }, [userMsg])).toBeUndefined();
  });

  test("matches on nested pattern keys", () => {
    const message = defineMapping({
      match: { type: "response_item", payload: { type: "message" } },
      emit: () => [{ type: "agent_message" as const }],
    });

    expect(
      dispatch({ type: "response_item", payload: { type: "message", text: "x" } }, [message]),
    ).toBe(message);
    expect(
      dispatch({ type: "response_item", payload: { type: "reasoning" } }, [message]),
    ).toBeUndefined();
  });

  test("first matching mapping wins when patterns overlap", () => {
    const specific = defineMapping({
      match: { type: "response_item", payload: { type: "message" } },
      emit: () => [{ type: "agent_message" as const }],
    });
    const broad = defineMapping({
      match: { type: "response_item" },
      emit: () => [{ type: "unknown" as const }],
    });

    const record = { type: "response_item", payload: { type: "message" } };
    expect(dispatch(record, [specific, broad])).toBe(specific);
    expect(dispatch(record, [broad, specific])).toBe(broad);
  });
});
