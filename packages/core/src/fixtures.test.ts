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

const usageTrail = (usage: object) =>
  `${[
    {
      type: "session",
      schema_version: "0.1.0",
      id: "01HSESS0000000000000000001",
      session_uid: "01HZZZZZZZZZZZZZZZZZZZZZ01",
      ts: "2026-05-17T14:00:00.000Z",
      agent: { name: "codex-cli" },
    },
    {
      type: "agent_message",
      id: "01HEVTA0000000000000000001",
      ts: "2026-05-17T14:00:01.000Z",
      payload: { text: "hi", usage },
    },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;

test("agent_message usage accepts total-only coverage", async () => {
  const diagnostics = await validateTrailString(usageTrail({ total_tokens: 42 }));
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});

test("agent_message usage accepts cumulative-total-only coverage", async () => {
  const diagnostics = await validateTrailString(usageTrail({ total_tokens_cumulative: 420 }));
  expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
});

test("agent_message usage still rejects empty usage", async () => {
  const diagnostics = await validateTrailString(usageTrail({}));
  expect(diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
});
