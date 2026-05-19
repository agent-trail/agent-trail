import type { JsonlParseError } from "./jsonl.ts";

export type DiagnosticSeverity = "error" | "warning";

export type Diagnostic = {
  line: number;
  path: string;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
};

export function createDiagnostic(diagnostic: Diagnostic): Diagnostic {
  return { ...diagnostic };
}

export function formatDiagnosticText(diagnostic: Diagnostic): string {
  const severity = escapeDiagnosticTextSegment(diagnostic.severity);
  const code = escapeDiagnosticTextSegment(diagnostic.code);
  const path = diagnostic.path === "" ? "<root>" : escapeDiagnosticTextSegment(diagnostic.path);
  const message = escapeDiagnosticTextSegment(diagnostic.message);

  return `${severity} ${code} line ${diagnostic.line} ${path}: ${message}`;
}

export function formatDiagnosticsText(diagnostics: Iterable<Diagnostic>): string {
  return Array.from(diagnostics, formatDiagnosticText).join("\n");
}

export function formatDiagnosticsJsonValue(diagnostics: Iterable<Diagnostic>): Diagnostic[] {
  return Array.from(diagnostics, createDiagnostic);
}

export function diagnosticFromJsonlParseError(error: JsonlParseError): Diagnostic {
  return createDiagnostic({
    line: error.line,
    path: "",
    severity: "error",
    code: error.code,
    message: error.message,
  });
}

function escapeDiagnosticTextSegment(value: string): string {
  let escaped = "";

  for (const character of value) {
    const charCode = character.charCodeAt(0);

    if (charCode < 0x20 || charCode === 0x7f) {
      switch (character) {
        case "\n":
          escaped += "\\n";
          break;
        case "\r":
          escaped += "\\r";
          break;
        case "\t":
          escaped += "\\t";
          break;
        default:
          escaped += `\\u${charCode.toString(16).padStart(4, "0")}`;
      }
    } else {
      escaped += character;
    }
  }

  return escaped;
}
