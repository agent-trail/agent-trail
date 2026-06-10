import { createDiagnostic, type Diagnostic, type DiagnosticSeverity } from "./diagnostics.ts";
import type { JsonlRecord } from "./jsonl.ts";
import { appendJsonPointerSegment } from "./validation-utils.ts";

const ILL_FORMED_STRING_MESSAGE =
  "String contains an unpaired surrogate; writers must replace it with U+FFFD";

export function illFormedStringDiagnostics(
  record: JsonlRecord,
  severity: DiagnosticSeverity,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const stack: Array<{ value: unknown; path: string }> = [{ value: record.value, path: "" }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const { value, path } = current;

    if (typeof value === "string") {
      if (hasUnpairedSurrogate(value)) {
        diagnostics.push(
          createDiagnostic({
            line: record.line,
            path,
            severity,
            code: "ill_formed_string",
            message: ILL_FORMED_STRING_MESSAGE,
          }),
        );
      }
      continue;
    }

    if (Array.isArray(value)) {
      const arrayEntries = Array.from(value.entries()).reverse();
      for (const [i, item] of arrayEntries) {
        stack.push({ value: item, path: appendJsonPointerSegment(path, String(i)) });
      }
      continue;
    }

    if (value !== null && typeof value === "object") {
      const objEntries = Object.entries(value).reverse();
      for (const [key, child] of objEntries) {
        const pathKey = replaceUnpairedSurrogates(key);
        if (hasUnpairedSurrogate(key)) {
          diagnostics.push(
            createDiagnostic({
              line: record.line,
              path: appendJsonPointerSegment(path, pathKey),
              severity,
              code: "ill_formed_string",
              message: ILL_FORMED_STRING_MESSAGE,
            }),
          );
        }
        stack.push({ value: child, path: appendJsonPointerSegment(path, pathKey) });
      }
    }
  }

  return diagnostics;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i += 1;
        continue;
      }
      return true;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function replaceUnpairedSurrogates(value: string): string {
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
        out += "\ufffd";
        changed = true;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      out += "\ufffd";
      changed = true;
      continue;
    }
    out += value[i] ?? "";
  }

  return changed ? out : value;
}
