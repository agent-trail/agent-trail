import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AnySchema } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

type DiagnosticAssertion = {
  line: number;
  path?: string;
  severity?: "error" | "warning";
  code?: string;
};

type ConformanceClass = "W" | "R1" | "R2";

type ManifestFixture = {
  path: string;
  classes: ConformanceClass[];
  comment?: string;
  strict: {
    valid: boolean;
    diagnostics: DiagnosticAssertion[];
  };
  tolerant: {
    clean: boolean;
    diagnostics: DiagnosticAssertion[];
  };
  expected?: {
    session_hashes?: string[];
    file_hash?: string;
  };
};

type Manifest = {
  schema_version: "0.1.0";
  fixtures: ManifestFixture[];
};

const checkOnly = process.argv.includes("--check");
const rootUrl = new URL("../", import.meta.url);
const fixtureRootUrl = new URL("tests/fixtures/validation/", rootUrl);
const packageConformanceUrl = new URL("packages/schema/conformance/", rootUrl);
const packageFixtureRootUrl = new URL("fixtures/", packageConformanceUrl);
const manifestUrl = new URL("manifest.json", fixtureRootUrl);
const manifestSchemaUrl = new URL("manifest.schema.json", fixtureRootUrl);
const readmeUrl = new URL("README.md", fixtureRootUrl);
const specUrl = new URL("spec.md", rootUrl);

const GENERATED_START = "<!-- conformance-manifest:start -->";
const GENERATED_END = "<!-- conformance-manifest:end -->";
const CLASS_ORDER: Record<ConformanceClass, number> = { W: 0, R1: 1, R2: 2 };

// Spec-named portable diagnostic codes. AJV/schema keyword codes stay out of
// this allowlist; manifest rows for those failures assert verdict and line only.
const PORTABLE_CODES = new Set([
  "ambiguous_sequential_pairing",
  "child_session_fork_from_mismatch",
  "child_session_parent_link_mismatch",
  "content_hash_invalid",
  "content_hash_mismatch",
  "cross_group_fork_from_hash_mismatch",
  "duplicate_id",
  "duplicate_option_labels",
  "duplicate_segment_seq",
  "duplicate_tool_result",
  "duplicate_user_query_question_id",
  "envelope_has_parent_id",
  "envelope_not_at_line_1",
  "envelope_sessions_manifest_drift",
  "events_before_first_session_header",
  "header_has_parent_id",
  "ill_formed_string",
  "missing_header",
  "missing_header_after_envelope",
  "multiple_envelopes",
  "non_interoperable_number",
  "non_monotonic_event_ts",
  "out_of_order_segment_seq",
  "out_of_order_session_headers",
  "parent_cycle",
  "parse_fidelity_drift",
  "reader_tolerant_schema_version",
  "reader_tolerant_unknown_payload_field",
  "reader_tolerant_unknown_record",
  "segment_chain_break",
  "source_raw_envelope_ref_unresolved",
  "source_raw_unredacted_secret",
  "stream_open_with_content_hash",
  "stream_open_with_terminal_event",
  "tool_args_unredacted_secret",
  "tool_result_semantic_conflict",
  "unknown_abandoned_branch_id",
  "unknown_branch_point_from_id",
  "unknown_final_message_id",
  "unknown_parent_id",
  "unknown_user_query_answer_key",
  "unknown_user_query_for_id",
  "unmatched_tool_call_at_eof",
  "vcs_remote_url_with_credentials",
  "vcs_revision_divergence",
]);

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, "utf8")) as T;
}

async function listFixturePaths(dirUrl = fixtureRootUrl, prefix = ""): Promise<string[]> {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(
        ...(await listFixturePaths(new URL(`${entry.name}/`, dirUrl), `${relativePath}/`)),
      );
    } else if (entry.isFile() && entry.name.endsWith(".trail.jsonl")) {
      paths.push(relativePath);
    }
  }
  return paths.sort();
}

function assertManifestSchema(manifest: Manifest, schema: unknown): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema as AnySchema);
  if (!validate(manifest)) {
    fail(
      `manifest.json does not match manifest.schema.json:\n${JSON.stringify(validate.errors, null, 2)}`,
    );
  }
}

function assertSortedAndCovered(manifest: Manifest, fixturePaths: string[]): void {
  const manifestPaths = manifest.fixtures.map((fixture) => fixture.path);
  const sortedManifestPaths = [...manifestPaths].sort();
  if (JSON.stringify(manifestPaths) !== JSON.stringify(sortedManifestPaths)) {
    fail("manifest.json fixtures must be sorted by path.");
  }

  const duplicates = manifestPaths.filter((path, index) => manifestPaths.indexOf(path) !== index);
  if (duplicates.length > 0) {
    fail(`manifest.json contains duplicate fixture paths:\n${duplicates.join("\n")}`);
  }

  const missing = fixturePaths.filter((path) => !manifestPaths.includes(path));
  const extra = manifestPaths.filter((path) => !fixturePaths.includes(path));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      [
        "manifest.json fixture coverage drift.",
        missing.length > 0 ? `Missing:\n${missing.join("\n")}` : undefined,
        extra.length > 0 ? `Extra:\n${extra.join("\n")}` : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}

function assertPortableCodes(manifest: Manifest): void {
  const nonPortable = manifest.fixtures.flatMap((fixture) =>
    [
      ...fixture.strict.diagnostics.map((diagnostic) => ({
        fixture,
        diagnostic,
        profile: "strict",
      })),
      ...fixture.tolerant.diagnostics.map((diagnostic) => ({
        fixture,
        diagnostic,
        profile: "tolerant",
      })),
    ].filter(
      ({ diagnostic }) => diagnostic.code !== undefined && !PORTABLE_CODES.has(diagnostic.code),
    ),
  );

  if (nonPortable.length > 0) {
    fail(
      `manifest.json includes non-portable diagnostic codes:\n${nonPortable
        .map(({ fixture, diagnostic, profile }) => `${fixture.path} ${profile} ${diagnostic.code}`)
        .join("\n")}`,
    );
  }
}

function assertPortableCodeRegistryMatchesSpec(spec: string): void {
  const start = spec.indexOf("Portable diagnostic code registry:");
  const end = spec.indexOf("#### Conformance suite", start);
  if (start === -1 || end === -1) {
    fail("Unable to find portable diagnostic code registry in spec.md.");
  }

  const registrySection = spec.slice(start, end);
  const specCodes = new Set<string>();
  for (const line of registrySection.split("\n")) {
    const match = line.match(/^\| `([^`]+)` \|/);
    if (match?.[1] !== undefined) {
      specCodes.add(match[1]);
    }
  }

  const missing = [...specCodes].filter((code) => !PORTABLE_CODES.has(code));
  const extra = [...PORTABLE_CODES].filter((code) => !specCodes.has(code));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      [
        "scripts/check-conformance.ts PORTABLE_CODES must match spec.md portable diagnostic registry.",
        missing.length > 0 ? `Missing from script:\n${missing.join("\n")}` : undefined,
        extra.length > 0 ? `Extra in script:\n${extra.join("\n")}` : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
}

function renderGeneratedReadmeSection(manifest: Manifest): string {
  const grouped = new Map<string, ManifestFixture[]>();
  for (const fixture of manifest.fixtures) {
    const category = fixture.path.slice(0, fixture.path.indexOf("/"));
    const fixtures = grouped.get(category) ?? [];
    fixtures.push(fixture);
    grouped.set(category, fixtures);
  }

  const lines = [
    GENERATED_START,
    "## Scenarios",
    "",
    "This section is generated from `manifest.json`; run `bun run sync:conformance` after fixture or expectation changes.",
    "",
  ];

  for (const [category, fixtures] of [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(`### ${category}/`, "");
    for (const fixture of fixtures) {
      lines.push(
        `- \`${fixture.path}\` — classes: ${formatConformanceClasses(fixture.classes)}, strict: ${strictSummary(fixture)}, tolerant: ${tolerantSummary(fixture)}`,
      );
    }
    lines.push("");
  }

  lines.push(GENERATED_END, "");
  return `${lines.join("\n")}`;
}

function formatConformanceClasses(classes: ConformanceClass[]): string {
  return [...classes].sort((a, b) => CLASS_ORDER[a] - CLASS_ORDER[b]).join(", ");
}

function strictSummary(fixture: ManifestFixture): string {
  return fixture.strict.valid
    ? fixture.strict.diagnostics.length === 0
      ? "valid"
      : `valid with ${fixture.strict.diagnostics.length} diagnostic(s)`
    : `invalid with ${fixture.strict.diagnostics.length} assertion(s)`;
}

function tolerantSummary(fixture: ManifestFixture): string {
  return fixture.tolerant.clean ? "clean" : `${fixture.tolerant.diagnostics.length} diagnostic(s)`;
}

function updateGeneratedReadmeSection(readme: string, generated: string): string {
  const start = readme.indexOf(GENERATED_START);
  const end = readme.indexOf(GENERATED_END);
  if (start === -1 || end === -1 || end < start) {
    const scenarioStart = readme.indexOf("## Scenarios");
    if (scenarioStart === -1) {
      return `${readme.trimEnd()}\n\n${generated}`;
    }
    return `${readme.slice(0, scenarioStart).trimEnd()}\n\n${generated}`;
  }
  return `${readme.slice(0, start)}${generated}${readme.slice(end + GENERATED_END.length).replace(/^\s*/, "")}`;
}

async function assertOrUpdateReadme(manifest: Manifest): Promise<void> {
  const readme = await readFile(readmeUrl, "utf8");
  const expected = updateGeneratedReadmeSection(readme, renderGeneratedReadmeSection(manifest));
  if (readme === expected) return;
  if (checkOnly) {
    fail(
      "tests/fixtures/validation/README.md conformance section is stale. Run bun run sync:conformance.",
    );
  }
  await writeFile(readmeUrl, expected);
}

async function mirrorConformanceCorpus(): Promise<void> {
  if (checkOnly) return;
  await rm(packageConformanceUrl, { recursive: true, force: true });
  await mkdir(packageFixtureRootUrl, { recursive: true });
  await cp(manifestUrl, new URL("manifest.json", packageConformanceUrl));
  await cp(manifestSchemaUrl, new URL("manifest.schema.json", packageConformanceUrl));

  const fixturePaths = await listFixturePaths();
  await Promise.all(
    fixturePaths.map(async (path) => {
      const source = new URL(path, fixtureRootUrl);
      const target = new URL(path, packageFixtureRootUrl);
      await mkdir(dirname(fileURLToPath(target)), { recursive: true });
      await cp(source, target);
    }),
  );
}

async function assertMirroredConformanceCorpus(): Promise<void> {
  const expectedFiles = [
    "manifest.json",
    "manifest.schema.json",
    ...(await listFixturePaths()).map((path) => `fixtures/${path}`),
  ].sort();
  const actualFiles = await listPackageConformancePaths();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail("packages/schema/conformance is stale. Run bun run sync:conformance.");
  }

  await Promise.all(
    expectedFiles.map(async (path) => {
      const canonicalUrl =
        path === "manifest.json" || path === "manifest.schema.json"
          ? new URL(path, fixtureRootUrl)
          : new URL(path.replace(/^fixtures\//, ""), fixtureRootUrl);
      const mirroredUrl = new URL(path, packageConformanceUrl);
      const [canonicalContent, mirroredContent] = await Promise.all([
        readFile(canonicalUrl, "utf8"),
        readFile(mirroredUrl, "utf8"),
      ]);
      if (canonicalContent !== mirroredContent) {
        fail(`packages/schema/conformance/${path} is stale. Run bun run sync:conformance.`);
      }
    }),
  );
}

async function listPackageConformancePaths(): Promise<string[]> {
  try {
    return (await listFiles(packageConformanceUrl)).sort();
  } catch {
    return [];
  }
}

async function listFiles(dirUrl: URL, prefix = ""): Promise<string[]> {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...(await listFiles(new URL(`${entry.name}/`, dirUrl), `${relativePath}/`)));
    } else if (entry.isFile()) {
      paths.push(relativePath);
    }
  }
  return paths.sort();
}

let manifest: Manifest | undefined;
try {
  manifest = await readJson<Manifest>(manifestUrl);
} catch (error) {
  fail(`Unable to read tests/fixtures/validation/manifest.json: ${error}`);
}
const checkedManifest: Manifest =
  manifest ?? fail("Unable to read tests/fixtures/validation/manifest.json.");
const manifestSchema = await readJson<unknown>(manifestSchemaUrl);
const fixturePaths = await listFixturePaths();
const spec = await readFile(specUrl, "utf8");

assertPortableCodeRegistryMatchesSpec(spec);
assertManifestSchema(checkedManifest, manifestSchema);
assertSortedAndCovered(checkedManifest, fixturePaths);
assertPortableCodes(checkedManifest);
await assertOrUpdateReadme(checkedManifest);
await mirrorConformanceCorpus();
if (checkOnly) await assertMirroredConformanceCorpus();
