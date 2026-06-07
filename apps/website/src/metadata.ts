export const SITE_ORIGIN = "https://agent-trail.dev";
export const SITE_NAME = "Agent Trail";
export const DEFAULT_DESCRIPTION =
  "Agent Trail is a portable JSONL format for coding-agent sessions.";
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og.svg`;

type PageMetadataOptions = {
  description?: string;
  path: string;
  robots?: "index,follow" | "noindex";
  title?: string;
};

type HeadLink = {
  href: string;
  rel: string;
};

type HeadMeta =
  | { charSet: string }
  | { content: string; name: string }
  | { content: string; property: string }
  | { title: string };

export function absoluteUrl(path: string) {
  return new URL(path, SITE_ORIGIN).toString();
}

export function pageTitle(title?: string) {
  return title === undefined ? SITE_NAME : `${title} | ${SITE_NAME}`;
}

export function buildPageMetadata({
  description = DEFAULT_DESCRIPTION,
  path,
  robots = "index,follow",
  title,
}: PageMetadataOptions): { links: HeadLink[]; meta: HeadMeta[] } {
  const canonical = absoluteUrl(path);
  const resolvedTitle = pageTitle(title);

  return {
    links: [{ rel: "canonical", href: canonical }],
    meta: [
      { title: resolvedTitle },
      { name: "description", content: description },
      { name: "robots", content: robots },
      { property: "og:title", content: resolvedTitle },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: canonical },
      { property: "og:image", content: DEFAULT_OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: resolvedTitle },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: DEFAULT_OG_IMAGE },
    ],
  };
}
