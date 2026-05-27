import type { ErrorObject } from "ajv";
import type { JsonlRecord } from "./jsonl.ts";

export function appendJsonPointerSegment(path: string, segment: string): string {
  return `${path}/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

export function hasStringParam<T extends string>(
  params: ErrorObject["params"],
  key: T,
): params is ErrorObject["params"] & Record<T, string> {
  return key in params && typeof params[key] === "string";
}

export function isHeaderLikeRecord(record: JsonlRecord): boolean {
  const recordType = record.value?.type;
  return recordType === "trail" || recordType === "session";
}
