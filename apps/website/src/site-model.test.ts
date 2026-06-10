import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { validateTrailString } from "../../../packages/core/src/index.ts";
import { buildLandingPageModel, buildSchemaResponse, buildSpecPageModel } from "./site.ts";
import { repoRoot } from "./test-support.ts";

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
  ).toBe("https://github.com/agent-trail/agent-trail/issues/30");
  expect(model.referenceImplementations.find((surface) => surface.name === "Gist viewer")).toEqual({
    name: "Gist viewer",
    packageLabel: "/view/gist/:gistId",
    status: "available",
    href: "https://github.com/agent-trail/agent-trail/issues/30",
  });
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
