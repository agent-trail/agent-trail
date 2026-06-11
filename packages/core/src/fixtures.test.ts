import { expect, test } from "bun:test";
import manifest from "../../../tests/fixtures/validation/manifest.json" with { type: "json" };
import { validateTrailString } from "./index.ts";

type DiagnosticAssertion = {
  line: number;
  path?: string;
  severity?: "error" | "warning";
  code?: string;
};

type ManifestFixture = {
  path: string;
  strict: {
    valid: boolean;
    diagnostics: DiagnosticAssertion[];
  };
  tolerant: {
    clean: boolean;
    diagnostics: DiagnosticAssertion[];
  };
};

type Diagnostic = {
  line: number;
  path: string;
  severity: "error" | "warning";
  code: string;
};

const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const PORTABLE_CODES = new Set(
  (manifest as { fixtures: ManifestFixture[] }).fixtures.flatMap((fixture) =>
    [...fixture.strict.diagnostics, ...fixture.tolerant.diagnostics]
      .map((diagnostic) => diagnostic.code)
      .filter((code): code is string => code !== undefined),
  ),
);

const loadFixture = (rel: string) => Bun.file(new URL(rel, FIXTURES)).text();

function simplifyDiagnostics(diagnostics: Diagnostic[]): DiagnosticAssertion[] {
  const assertions = diagnostics.map((diagnostic) =>
    PORTABLE_CODES.has(diagnostic.code)
      ? {
          line: diagnostic.line,
          path: diagnostic.path,
          severity: diagnostic.severity,
          code: diagnostic.code,
        }
      : { line: diagnostic.line },
  );
  const seen = new Set<string>();
  return assertions
    .filter((assertion) => {
      const key = JSON.stringify(assertion);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareDiagnosticAssertions);
}

function compareDiagnosticAssertions(a: DiagnosticAssertion, b: DiagnosticAssertion): number {
  return (
    a.line - b.line ||
    (a.path ?? "").localeCompare(b.path ?? "") ||
    (a.code ?? "").localeCompare(b.code ?? "")
  );
}

for (const fixture of (manifest as { fixtures: ManifestFixture[] }).fixtures) {
  test(`${fixture.path} matches strict conformance expectation`, async () => {
    const diagnostics = await validateTrailString(await loadFixture(fixture.path));
    expect(diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(
      !fixture.strict.valid,
    );
    expect(simplifyDiagnostics(diagnostics)).toEqual(fixture.strict.diagnostics);
  });

  test(`${fixture.path} matches reader-tolerant conformance expectation`, async () => {
    const diagnostics = await validateTrailString(await loadFixture(fixture.path), {
      profile: "reader-tolerant",
    });
    expect(diagnostics.length === 0).toBe(fixture.tolerant.clean);
    expect(simplifyDiagnostics(diagnostics)).toEqual(fixture.tolerant.diagnostics);
  });
}
