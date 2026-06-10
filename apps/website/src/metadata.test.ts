import { expect, test } from "bun:test";

import {
  buildPageMetadata,
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  pageTitle,
  SITE_ORIGIN,
} from "./metadata.ts";

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
