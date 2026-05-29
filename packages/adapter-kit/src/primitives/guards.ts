export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function jsonObjectValue(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}
