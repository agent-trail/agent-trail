const REPLACEMENT_CHARACTER = "\ufffd";

export function sanitizeJsonString(value: string): string {
  let out = "";
  let changed = false;

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] ?? "";
        i += 1;
        out += value[i] ?? "";
      } else {
        out += REPLACEMENT_CHARACTER;
        changed = true;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += REPLACEMENT_CHARACTER;
      changed = true;
      continue;
    }
    out += value[i] ?? "";
  }

  return changed ? out : value;
}

export function sanitizeJsonStrings<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeJsonString(value) as T;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = sanitizeJsonStrings(value[i]);
    }
    return value;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = sanitizeJsonStrings(obj[key]);
    }
  }
  return value;
}

export function sanitizeTrailFile<T extends object>(trail: T): T {
  return sanitizeJsonStrings(trail);
}
