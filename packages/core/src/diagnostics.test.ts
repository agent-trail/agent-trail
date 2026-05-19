import { expect, test } from "bun:test";
import {
  createDiagnostic,
  diagnosticFromJsonlParseError,
  formatDiagnosticsJsonValue,
  formatDiagnosticsText,
  formatDiagnosticText,
  JsonlParseError,
} from "./index.ts";

test("creates diagnostics with the portable validation fields", () => {
  const diagnostic = createDiagnostic({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "required",
    message: "Missing required property",
  });

  expect(diagnostic).toEqual({
    line: 2,
    path: "/payload/text",
    severity: "error",
    code: "required",
    message: "Missing required property",
  });
});

test("formats an error diagnostic as compact text", () => {
  const diagnostic = createDiagnostic({
    line: 2,
    path: "",
    severity: "error",
    code: "invalid_json",
    message: "Invalid JSON on line 2",
  });

  expect(formatDiagnosticText(diagnostic)).toBe(
    "error invalid_json line 2 <root>: Invalid JSON on line 2",
  );
});

test("formats a warning diagnostic as compact text", () => {
  const diagnostic = createDiagnostic({
    line: 4,
    path: "/payload/text",
    severity: "warning",
    code: "unknown_field",
    message: "Unknown field will be ignored",
  });

  expect(formatDiagnosticText(diagnostic)).toBe(
    "warning unknown_field line 4 /payload/text: Unknown field will be ignored",
  );
});

test("formats multiple diagnostics as newline-delimited text", () => {
  const diagnostics = [
    createDiagnostic({
      line: 1,
      path: "",
      severity: "error",
      code: "invalid_header",
      message: "Invalid header",
    }),
    createDiagnostic({
      line: 3,
      path: "/payload",
      severity: "warning",
      code: "reader_tolerant",
      message: "Preserved unknown record",
    }),
  ];

  expect(formatDiagnosticsText(diagnostics)).toBe(
    [
      "error invalid_header line 1 <root>: Invalid header",
      "warning reader_tolerant line 3 /payload: Preserved unknown record",
    ].join("\n"),
  );
});

test("escapes control characters in compact text formatting", () => {
  const diagnostic = createDiagnostic({
    line: 8,
    path: "/payload/bad\npath",
    severity: "error",
    code: "bad\tcode",
    message: "bad id\nerror fake line 1 <root>: spoofed\u0007",
  });

  const text = formatDiagnosticText(diagnostic);

  expect(text).toBe(
    "error bad\\tcode line 8 /payload/bad\\npath: bad id\\nerror fake line 1 <root>: spoofed\\u0007",
  );
  expect(text).not.toContain("\n");
});

test("formats diagnostics as JSON values with the portable fields", () => {
  const diagnostics = [
    createDiagnostic({
      line: 5,
      path: "/events/0/payload\nraw",
      severity: "error",
      code: "type_mismatch",
      message: "Expected object payload\nexact",
    }),
  ];

  expect(formatDiagnosticsJsonValue(diagnostics)).toEqual([
    {
      line: 5,
      path: "/events/0/payload\nraw",
      severity: "error",
      code: "type_mismatch",
      message: "Expected object payload\nexact",
    },
  ]);
});

test("converts JSONL parse errors into portable diagnostics", () => {
  const error = new JsonlParseError("invalid_json", 2, "Invalid JSON on line 2", '{"bad":');

  expect(diagnosticFromJsonlParseError(error)).toEqual({
    line: 2,
    path: "",
    severity: "error",
    code: "invalid_json",
    message: "Invalid JSON on line 2",
  });
});
