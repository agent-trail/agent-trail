import safeRegex from "safe-regex2";

const MAX_REGEX_SOURCE_LENGTH = 512;

export function assertSafeRegexSource(source: string, label: string): void {
  if (source.length > MAX_REGEX_SOURCE_LENGTH) {
    throw new Error(`${label} regex exceeds ${MAX_REGEX_SOURCE_LENGTH} characters`);
  }
  if (hasBackreference(source)) throw new Error(`${label} regex backreferences are not supported`);
  if (hasLookaround(source)) throw new Error(`${label} regex lookaround is not supported`);
  if (hasNestedUnboundedQuantifier(source)) {
    throw new Error(`${label} regex has nested unbounded quantifiers`);
  }
  if (hasQuantifiedAlternation(source)) {
    throw new Error(`${label} regex has quantified alternation`);
  }
  if (!safeRegex(source, { limit: 25 })) throw new Error(`${label} regex is unsafe`);
}

function hasBackreference(source: string): boolean {
  for (let i = 0; i < source.length - 1; i += 1) {
    if (source[i] !== "\\" || isEscaped(source, i)) continue;
    const next = source[i + 1] ?? "";
    if (/[1-9]/.test(next) || next === "k") return true;
  }
  return false;
}

function hasLookaround(source: string): boolean {
  for (let i = 0; i < source.length - 2; i += 1) {
    if (source[i] !== "(" || isEscaped(source, i) || source[i + 1] !== "?") continue;
    const marker = source[i + 2];
    if (marker === "=" || marker === "!" || marker === "<") return true;
  }
  return false;
}

function hasNestedUnboundedQuantifier(source: string): boolean {
  const stack: Array<{ start: number; hasQuantifier: boolean }> = [];
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === undefined || isEscaped(source, i)) continue;
    if (char === "[" && !inClass) {
      inClass = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if (char === "(") {
      stack.push({ start: i, hasQuantifier: false });
      continue;
    }
    if (isQuantifierStart(source, i)) {
      const current = stack.at(-1);
      if (current !== undefined && i > current.start + 1) current.hasQuantifier = true;
      continue;
    }
    if (char !== ")") continue;
    const group = stack.pop();
    if (group === undefined) continue;
    if (group.hasQuantifier && isUnboundedQuantifierAfter(source, i + 1)) return true;
    const parent = stack.at(-1);
    if (parent !== undefined && group.hasQuantifier) parent.hasQuantifier = true;
  }
  return false;
}

function hasQuantifiedAlternation(source: string): boolean {
  const stack: Array<{ hasAlternation: boolean }> = [];
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === undefined || isEscaped(source, i)) continue;
    if (char === "[" && !inClass) {
      inClass = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if (char === "(") {
      stack.push({ hasAlternation: false });
      continue;
    }
    if (char === ")" && stack.length > 0) {
      const group = stack.pop();
      if (group?.hasAlternation && isQuantifierAfter(source, i + 1)) {
        return true;
      }
      const parent = stack.at(-1);
      if (parent !== undefined && group?.hasAlternation) parent.hasAlternation = true;
      continue;
    }
    const current = stack.at(-1);
    if (current === undefined) continue;
    if (char === "|") current.hasAlternation = true;
  }
  return false;
}

function isQuantifierStart(source: string, index: number): boolean {
  const char = source[index];
  if (char === "*" || char === "+") return true;
  if (char !== "{") return false;
  const close = source.indexOf("}", index + 1);
  if (close === -1) return false;
  return /^\{\d+(?:,\d*)?\}$/.test(source.slice(index, close + 1));
}

function isUnboundedQuantifierAfter(source: string, index: number): boolean {
  const char = source[index];
  if (char === "*" || char === "+") return true;
  if (char !== "{") return false;
  const close = source.indexOf("}", index + 1);
  if (close === -1) return false;
  return /^\{\d+,\}$/.test(source.slice(index, close + 1));
}

function isQuantifierAfter(source: string, index: number): boolean {
  const char = source[index];
  if (char === "*" || char === "+" || char === "?") return true;
  if (char !== "{") return false;
  const close = source.indexOf("}", index + 1);
  if (close === -1) return false;
  return /^\{\d+(?:,\d*)?\}$/.test(source.slice(index, close + 1));
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}
