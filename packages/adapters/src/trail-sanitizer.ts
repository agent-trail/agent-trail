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
  if (value === null || typeof value !== "object") {
    return value;
  }

  const seen = new WeakSet<object>();
  const stack: object[] = [];
  const push = (item: unknown) => {
    if (item === null || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    stack.push(item);
  };

  push(value);
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;

    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i += 1) {
        const child = current[i];
        if (typeof child === "string") {
          current[i] = sanitizeJsonString(child);
        } else {
          push(child);
        }
      }
      continue;
    }

    const obj = current as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const child = obj[key];
      const sanitizedKey = sanitizeJsonString(key);
      const sanitizedChild = typeof child === "string" ? sanitizeJsonString(child) : child;
      if (sanitizedKey !== key) {
        delete obj[key];
        obj[sanitizedKey] = sanitizedChild;
      } else {
        obj[key] = sanitizedChild;
      }
      push(sanitizedChild);
    }
  }
  return value;
}

export function sanitizeTrailFile<T extends object>(trail: T): T {
  return sanitizeJsonStrings(trail);
}
