import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { ComponentType } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ThemeSwitcher } from "./components/shell.tsx";
import { SpecPage } from "./components/spec-page.tsx";
import { ArrowGlyph, RouteLink } from "./components/ui.tsx";
import { buildSpecPageModel } from "./site.ts";
import { repoRoot } from "./test-support.ts";

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
