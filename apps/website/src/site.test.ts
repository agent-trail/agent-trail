import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import type { ComponentType } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  canonicalizeRecords,
  computeContentHash,
  parseJsonlString,
  validateTrailString,
} from "../../../packages/core/src/index.ts";
import { ThemeSwitcher } from "./components/shell.tsx";
import { SpecPage } from "./components/spec-page.tsx";
import { ArrowGlyph, RouteLink } from "./components/ui.tsx";
import { ViewerShell } from "./components/viewer-shell.tsx";
import { buildGistViewerModel } from "./gist-viewer.ts";
import {
  buildPageMetadata,
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  pageTitle,
  SITE_ORIGIN,
} from "./metadata.ts";
import { buildLandingPageModel, buildSchemaResponse, buildSpecPageModel } from "./site.ts";

const repoRoot = new URL("../../../", import.meta.url);

async function seedSharedTrailPayload(
  opts: { overrideHash?: string; text?: string } = {},
): Promise<{ contentHash: string; filename: string; payloadText: string }> {
  const header: Record<string, unknown> = {
    type: "session",
    schema_version: "0.1.0",
    id: "01HSESS0000000000000000001",
    ts: "2026-05-17T14:00:00.000Z",
    agent: { name: "codex-cli" },
  };
  const userMsg = {
    type: "user_message",
    id: "01HEVTA0000000000000000001",
    ts: "2026-05-17T14:00:05.000Z",
    payload: { text: opts.text ?? "hello from shared trail" },
  };
  const draft = `${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`;
  const contentHash = computeContentHash(await parseJsonlString(draft));
  header.content_hash = opts.overrideHash ?? contentHash;
  const canonical = canonicalizeRecords(
    await parseJsonlString(`${JSON.stringify(header)}\n${JSON.stringify(userMsg)}\n`),
  );
  const payloadText = gzipSync(Buffer.from(canonical, "utf8")).toString("base64");
  return {
    contentHash,
    filename: `${contentHash.slice(0, 12)}.trail.jsonl.gz.b64`,
    payloadText,
  };
}

test("landing page model contains the minimal dark mono homepage content", async () => {
  const model = await buildLandingPageModel({
    readText: (path) => readFile(new URL(path, repoRoot), "utf8"),
  });

  expect(model.title).toBe("Agent Trail");
  expect(model.hook).toBe("open format for coding agent sessions");
  expect(model.summary).toContain("durable JSONL artifact");
  expect(model.summary).toContain("readable, streamable, versionable");
  expect(model.codePreview.split("\n")).toHaveLength(10);
  expect(model.primaryLinks).toEqual([
    { href: "/spec/latest", label: "Read spec" },
    { href: "/schema/latest.json", label: "View schema" },
  ]);
  expect(model.referenceImplementations.map((surface) => surface.name)).toEqual([
    "Node SDK",
    "CLI",
    "MCP",
    "Skills",
    "Gist viewer",
  ]);
  expect(model.referenceImplementations.find((surface) => surface.name === "Node SDK")).toEqual({
    name: "Node SDK",
    packageLabel: "@agent-trail/core",
    status: "available",
    href: "https://github.com/agent-trail/agent-trail/tree/main/packages/core",
  });
  expect(model.referenceImplementations.find((surface) => surface.name === "CLI")).toEqual({
    name: "CLI",
    packageLabel: "trail",
    status: "available",
    href: "https://github.com/agent-trail/agent-trail/tree/main/packages/cli",
  });
  expect(model.referenceImplementations.find((surface) => surface.name === "MCP")?.status).toBe(
    "planned",
  );
  expect(model.referenceImplementations.find((surface) => surface.name === "Skills")?.href).toBe(
    "https://github.com/agent-trail/agent-trail/issues?q=is%3Aissue%20%2363%20OR%20%2364%20OR%20%2367%20OR%20%2368",
  );
  expect(
    model.referenceImplementations.find((surface) => surface.name === "Gist viewer")?.href,
  ).toBe("/view/gist/example");
});

test("spec page model renders anchored HTML for version and latest aliases", async () => {
  const content = {
    readText: (path: string) => readFile(new URL(path, repoRoot), "utf8"),
  };
  const versioned = await buildSpecPageModel({ ...content, routeVersion: "v0.1.0" });
  const latest = await buildSpecPageModel({ ...content, routeVersion: "latest" });

  expect(versioned.version).toBe("0.1.0");
  expect(versioned.status).toBe("Draft");
  expect(versioned.license).toBe("Apache-2.0");
  expect(latest.version).toBe(versioned.version);
  expect(latest.html).toBe(versioned.html);
  expect(versioned.html).not.toContain('id="agent-trail-specification"');
  expect(versioned.html).toContain('id="1-motivation"');
  expect(versioned.html).toContain('href="#1-motivation"');
  expect(versioned.html).toContain('aria-label="Link to 1. Motivation"');
  expect(versioned.html).toContain("<pre><code");
  expect(versioned.sections[0]).toEqual({
    id: "agent-trail-specification",
    title: "Agent Trail Specification",
    level: 1,
    index: 0,
  });
  expect(versioned.sections.map((section) => section.id)).toContain("4-terminology");
  expect(
    versioned.glossaryTerms.find((entry) => entry.term === "Trail file")?.definition,
  ).toContain("JSONL file");
  expect(versioned.sampleBlocks.length).toBeGreaterThanOrEqual(8);
  expect(versioned.sampleBlocks.some((sample) => sample.sectionIds.includes("4-terminology"))).toBe(
    true,
  );
  expect(versioned.sampleBlocks.flatMap((sample) => sample.sectionIds)).not.toContain(
    "17-formal-schema",
  );
  expect(versioned.sampleBlocks.flatMap((sample) => sample.sectionIds)).not.toContain(
    "18-examples",
  );
  expect(versioned.sampleBlocks.flatMap((sample) => sample.sectionIds)).not.toContain("changelog");
  expect(versioned.sampleBlocks.flatMap((sample) => sample.sectionIds)).not.toContain(
    "appendix-a-minimal-valid-record",
  );
  expect(versioned.sampleBlocks.flatMap((sample) => sample.sectionIds)).not.toContain("license");
  for (const sample of versioned.sampleBlocks) {
    expect(sample.lines.length).toBeGreaterThan(5);
    for (const line of sample.lines) {
      expect(JSON.parse(line)).toHaveProperty("type");
    }
    const diagnostics = await validateTrailString(`${sample.lines.join("\n")}\n`);
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  }
  const allSampleLines = versioned.sampleBlocks.flatMap((sample) => sample.lines);
  expect(allSampleLines.join("\n")).not.toContain("<pending>");
  expect(allSampleLines.join("\n")).not.toContain('"type":"summary"');
  expect(
    versioned.sampleBlocks
      .find((sample) => sample.sectionIds.includes("10-canonical-tool-taxonomy"))
      ?.lines.join("\n"),
  ).toContain('"tool":"mcp_call"');
  expect(
    versioned.sampleBlocks
      .find((sample) => sample.sectionIds.includes("12-tree-and-branching"))
      ?.lines.join("\n"),
  ).toContain('"type":"branch_summary"');
  expect(
    versioned.sampleBlocks
      .find((sample) => sample.sectionIds.includes("13-canonical-agent-registry"))
      ?.lines.join("\n"),
  ).toContain('"name":"codex-cli"');
  expect(
    versioned.sampleBlocks
      .find((sample) => sample.sectionIds.includes("14-truncation-overflow-and-raw-source-size"))
      ?.lines.join("\n"),
  ).toContain('"elided":true');
  expect(latest.sections).toEqual(versioned.sections);
  expect(latest.glossaryTerms).toEqual(versioned.glossaryTerms);
  expect(latest.sampleBlocks).toEqual(versioned.sampleBlocks);
});

test("schema aliases return canonical schema JSON with schema content type", async () => {
  const content = {
    readText: (path: string) => readFile(new URL(path, repoRoot), "utf8"),
  };

  const canonical = await readFile(new URL("schema.json", repoRoot), "utf8");
  const versioned = await buildSchemaResponse({ ...content, routeVersion: "v0.1.0" });
  const latest = await buildSchemaResponse({ ...content, routeVersion: "latest" });

  expect(versioned.body).toBe(canonical);
  expect(latest.body).toBe(canonical);
  expect(versioned.contentType).toBe("application/schema+json");
  expect(latest.contentType).toBe("application/schema+json");
});

test("gist viewer model loads a valid shared trail through the injected gist fetcher", async () => {
  const seed = await seedSharedTrailPayload();

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async (gistId) => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: `https://gist.githubusercontent.com/${gistId}/raw/${seed.filename}`,
    }),
  });

  expect(model.gistId).toBe("abc123def4567890abcd");
  expect(model.title).toBe("Trail viewer");
  expect(model.status).toBe("loaded");
  if (model.status !== "loaded") throw new Error("expected loaded model");
  expect(model.filename).toBe(seed.filename);
  expect(model.contentHash).toBe(seed.contentHash);
  expect(model.diagnostics).toEqual([]);
  expect(model.summary).toEqual({
    records: 2,
    sessions: 1,
    warnings: 0,
  });
  expect(model.preview).toContain("hello from shared trail");
});

test("gist viewer model keeps hash mismatches as warnings", async () => {
  const seed = await seedSharedTrailPayload({ overrideHash: "0".repeat(64) });

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/hash-mismatch",
    }),
  });

  expect(model.status).toBe("loaded");
  if (model.status !== "loaded") throw new Error("expected loaded model");
  expect(model.summary.warnings).toBe(1);
  expect(model.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "content_hash_mismatch",
      severity: "warning",
    }),
  );
});

test("gist viewer model turns fetch and decode failures into error state", async () => {
  const fetchFailure = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => {
      throw new Error("not found");
    },
  });

  expect(fetchFailure).toEqual({
    title: "Trail viewer",
    status: "error",
    gistId: "abc123def4567890abcd",
    message: "Failed to fetch gist payload: not found",
    diagnostics: [],
  });

  const decodeFailure = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "broken.trail.jsonl.gz.b64",
      payloadText: "not-base64-gzip",
      sourceUrl: "https://gist.githubusercontent.com/raw/broken",
    }),
  });

  expect(decodeFailure.status).toBe("error");
  if (decodeFailure.status !== "error") throw new Error("expected error model");
  expect(decodeFailure.message).toContain("Failed to decode shared trail payload");
});

test("gist viewer model rejects non-gist ids without fetching", async () => {
  let fetchCalled = false;

  const model = await buildGistViewerModel({
    gistId: "example",
    fetchGistPayload: async () => {
      fetchCalled = true;
      throw new Error("should not fetch");
    },
  });

  expect(model).toEqual({
    title: "Trail viewer",
    status: "error",
    gistId: "example",
    message: "Unsupported gist id: expected 20-32 lowercase hex characters.",
    diagnostics: [],
  });
  expect(fetchCalled).toBe(false);
});

test("gist viewer model turns invalid trail content into error state with diagnostics", async () => {
  const invalidJsonl = '{"type":"session","schema_version":"0.1.0"}\n';
  const invalidPayloadText = gzipSync(Buffer.from(invalidJsonl, "utf8")).toString("base64");

  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: "invalid.trail.jsonl.gz.b64",
      payloadText: invalidPayloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/invalid",
    }),
  });

  expect(model.status).toBe("error");
  if (model.status !== "error") throw new Error("expected error model");
  expect(model.message).toBe("Shared trail failed reader-tolerant validation.");
  expect(model.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
});

test("viewer shell renders loaded shared trail state and warnings", async () => {
  const seed = await seedSharedTrailPayload({ overrideHash: "0".repeat(64) });
  const model = await buildGistViewerModel({
    gistId: "abc123def4567890abcd",
    fetchGistPayload: async () => ({
      filename: seed.filename,
      payloadText: seed.payloadText,
      sourceUrl: "https://gist.githubusercontent.com/raw/hash-mismatch",
    }),
  });

  const markup = renderToStaticMarkup(createElement(ViewerShell, { model }));

  expect(markup).toContain("abc123def4567890abcd");
  expect(markup).toContain(seed.filename);
  expect(markup).toContain("Loaded");
  expect(markup).toContain("Records");
  expect(markup).toContain("content_hash_mismatch");
  expect(markup).toContain("hello from shared trail");
});

test("metadata helper emits stable canonical and social defaults", () => {
  const metadata = buildPageMetadata({
    path: "/spec/latest",
    title: "Agent Trail Specification",
  });

  expect(pageTitle()).toBe("Agent Trail");
  expect(pageTitle("Agent Trail Specification")).toBe("Agent Trail Specification | Agent Trail");
  expect(metadata.links).toEqual([
    { rel: "canonical", href: "https://agent-trail.dev/spec/latest" },
  ]);
  expect(metadata.meta).toContainEqual({ title: "Agent Trail Specification | Agent Trail" });
  expect(metadata.meta).toContainEqual({ name: "description", content: DEFAULT_DESCRIPTION });
  expect(metadata.meta).toContainEqual({ name: "robots", content: "index,follow" });
  expect(metadata.meta).toContainEqual({
    property: "og:url",
    content: "https://agent-trail.dev/spec/latest",
  });
  expect(metadata.meta).toContainEqual({ property: "og:image", content: DEFAULT_OG_IMAGE });
  expect(metadata.meta).toContainEqual({ name: "twitter:image", content: DEFAULT_OG_IMAGE });
  expect(DEFAULT_OG_IMAGE.startsWith(SITE_ORIGIN)).toBe(true);
});

test("metadata helper can mark private or duplicate pages noindex", () => {
  const metadata = buildPageMetadata({ path: "/", robots: "noindex", title: "Not Found" });

  expect(metadata.meta).toContainEqual({ title: "Not Found | Agent Trail" });
  expect(metadata.meta).toContainEqual({ name: "robots", content: "noindex" });
});

test("accessibility primitives expose names, states, and hidden decoration", () => {
  const TestRouteLink = RouteLink as ComponentType<{
    ariaCurrent?: "page";
    href: string;
  }>;

  expect(renderToStaticMarkup(createElement(ThemeSwitcher))).toContain(
    'aria-label="Use light theme"',
  );
  expect(renderToStaticMarkup(createElement(ThemeSwitcher))).toContain('aria-pressed="true"');
  expect(renderToStaticMarkup(createElement(ThemeSwitcher))).toContain("black");
  expect(renderToStaticMarkup(createElement(ArrowGlyph))).toContain('aria-hidden="true"');
  expect(
    renderToStaticMarkup(
      createElement(
        TestRouteLink,
        { ariaCurrent: "page", href: "https://github.com/agent-trail/agent-trail" },
        "GitHub",
      ),
    ),
  ).toContain('aria-current="page"');
  expect(
    renderToStaticMarkup(
      createElement(
        TestRouteLink,
        { href: "https://github.com/agent-trail/agent-trail" },
        "GitHub",
      ),
    ),
  ).toContain('rel="noreferrer"');
});

test("spec reader renders accessible sidebars and contextual samples", async () => {
  const model = await buildSpecPageModel({
    readText: (path) => readFile(new URL(path, repoRoot), "utf8"),
    routeVersion: "latest",
  });
  const markup = renderToStaticMarkup(createElement(SpecPage, { model }));

  expect(markup).toContain('id="agent-trail-specification"');
  expect(markup).toContain('aria-label="Specification navigation map"');
  expect(markup).toContain('aria-label="Contextual trail JSONL samples"');
  expect(markup).toContain('aria-label="Collapse navigation map"');
  expect(markup).toContain('aria-pressed="false"');
  expect(markup).toContain('aria-current="true"');
  expect(markup).toContain("Navigation_map");
  expect(markup).toContain("Sample trail JSONL");
  expect(markup).not.toContain("one file / active section");
  expect(markup).toContain("sample-line-highlight");
  expect(markup).not.toContain("Spec glossary and section map");
});
