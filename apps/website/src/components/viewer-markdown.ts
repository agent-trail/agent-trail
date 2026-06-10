import MarkdownIt from "markdown-it";

const viewerMarkdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
});

const defaultMarkdownLinkOpen =
  viewerMarkdown.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

viewerMarkdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token?.attrGet("href") === "#") {
    token.attrJoin("class", "viewer-dead-link");
    token.attrSet("aria-disabled", "true");
    token.attrSet("aria-label", "Unavailable link");
    token.attrSet("tabindex", "-1");
    token.attrSet("title", "Unavailable redacted link");
  }
  return defaultMarkdownLinkOpen(tokens, idx, options, env, self);
};

export function renderViewerMarkdown(markdown: string): string {
  return viewerMarkdown.render(normalizeInvalidLinkDestinations(markdown));
}

export function normalizeInvalidLinkDestinations(markdown: string): string {
  return markdown.replace(
    /(\]\()(<[A-Za-z][A-Za-z0-9_-]*>[^)\s]*)(\))/g,
    (_match, prefix: string, _destination: string, suffix: string) => `${prefix}#${suffix}`,
  );
}

export function preventDeadMarkdownLinkNavigation(event: {
  preventDefault: () => void;
  target: EventTarget | null;
}): void {
  if (!isDeadMarkdownLinkEventTarget(event.target)) return;
  event.preventDefault();
}

export function bindDeadMarkdownLinkGuard(root: unknown): () => void {
  if (!hasClickListeners(root)) return () => undefined;
  const handleClick = (event: MouseEvent) => {
    preventDeadMarkdownLinkNavigation(event);
  };
  root.addEventListener("click", handleClick);
  return () => {
    root.removeEventListener("click", handleClick);
  };
}

function hasClickListeners(root: unknown): root is {
  addEventListener: (type: "click", listener: (event: MouseEvent) => void) => void;
  removeEventListener: (type: "click", listener: (event: MouseEvent) => void) => void;
} {
  return (
    typeof root === "object" &&
    root !== null &&
    "addEventListener" in root &&
    "removeEventListener" in root &&
    typeof root.addEventListener === "function" &&
    typeof root.removeEventListener === "function"
  );
}

export function isDeadMarkdownLinkEventTarget(target: EventTarget | null): boolean {
  if (!hasClosest(target)) return false;
  return target.closest('a.viewer-dead-link,a[href="#"][aria-disabled="true"]') !== null;
}

function hasClosest(target: EventTarget | null): target is EventTarget & {
  closest: (selector: string) => unknown;
} {
  return (
    typeof target === "object" &&
    target !== null &&
    "closest" in target &&
    typeof target.closest === "function"
  );
}
