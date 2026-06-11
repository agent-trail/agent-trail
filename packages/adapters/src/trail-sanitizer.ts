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
  if (!needsJsonStringSanitization(value)) {
    return value;
  }

  return cloneSanitizedJsonStrings(value) as T;
}

function needsJsonStringSanitization(value: object): boolean {
  const seen = new WeakSet<object>();
  const stack: object[] = [value];
  seen.add(value);

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;

    if (Array.isArray(current)) {
      for (const child of current) {
        if (typeof child === "string") {
          if (sanitizeJsonString(child) !== child) return true;
          continue;
        }
        if (child !== null && typeof child === "object" && !seen.has(child)) {
          seen.add(child);
          stack.push(child);
        }
      }
      continue;
    }

    const obj = current as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (sanitizeJsonString(key) !== key) return true;
      const child = obj[key];
      if (typeof child === "string") {
        if (sanitizeJsonString(child) !== child) return true;
        continue;
      }
      if (child !== null && typeof child === "object" && !seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }

  return false;
}

function cloneSanitizedJsonStrings(value: object): object {
  const root = Array.isArray(value) ? new Array(value.length) : {};
  const seen = new WeakMap<object, object>([[value, root]]);
  const stack: Array<{ source: object; target: object }> = [{ source: value, target: root }];

  const cloneChild = (child: unknown): unknown => {
    if (typeof child === "string") return sanitizeJsonString(child);
    if (child === null || typeof child !== "object") return child;

    const existing = seen.get(child);
    if (existing !== undefined) return existing;

    const cloned = Array.isArray(child) ? new Array(child.length) : {};
    seen.set(child, cloned);
    stack.push({ source: child, target: cloned });
    return cloned;
  };

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const { source, target } = current;

    if (Array.isArray(source)) {
      const targetArray = target as unknown[];
      for (let i = 0; i < source.length; i += 1) {
        targetArray[i] = cloneChild(source[i]);
      }
      continue;
    }

    const sourceObj = source as Record<string, unknown>;
    const targetObj = target as Record<string, unknown>;
    for (const key of Object.keys(sourceObj)) {
      targetObj[sanitizeJsonString(key)] = cloneChild(sourceObj[key]);
    }
  }

  return root;
}

export function sanitizeTrailFile<T extends object>(trail: T): T {
  return sanitizeJsonStrings(trail);
}
