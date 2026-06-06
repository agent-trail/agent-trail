# Design

## Design Language

Agent Trail uses a dark mono product language for the website and viewer shell: black and charcoal surfaces, thin sharp borders, grayscale text, Commit Mono typography, and compact artifact previews. The system should feel like a durable terminal record and a reference manual, not a hosted SaaS dashboard or a paper editorial page.

Public pages and app surfaces share the same visual vocabulary. The homepage stays mostly text: a brief format explanation, a short `.trail.jsonl` preview, spec/schema links, and reference implementation links. Spec pages prioritize readable long-form text and anchored headings. Viewer routes use denser product-mode layout while remaining non-functional until the viewer work lands.

## Color

Use Tailwind v4 theme tokens in `apps/website/src/styles.css`.

```css
@theme {
  --color-bg: #020202;
  --color-panel: #0b0b0b;
  --color-line: #2e2e2e;
  --color-line-muted: #161616;
  --color-muted: #535353;
  --color-text: #b2b2b2;
  --color-text-strong: #f1f1f1;
}
```

Color rules:

- Page backgrounds use `--color-bg`; bounded previews use `--color-panel`.
- Primary text uses `--color-text`; headings and important links use `--color-text-strong`.
- `--color-muted` is for metadata only. Do not use it for body copy.
- Borders use `--color-line` or `--color-line-muted`.
- Keep the palette grayscale unless a future issue introduces a semantic state system.

## Typography

- Use Commit Mono as the primary and only website font, loaded through `@fontsource/commit-mono`.
- Use weights 400, 500, and 700 only.
- Keep body text at `1rem` or larger. Use fixed responsive breakpoints, not viewport-fluid body sizing.
- Use large but restrained titles. Avoid negative tracking.
- Enable `font-feature-settings: "calt" 1, "kern" 1`.
- Keep prose line length around 65 to 75 characters.
- Use tabular, mono-friendly rhythm for JSONL previews, schema snippets, route literals, hashes, and package names.

## Layout

- Use a centered max-width shell with responsive horizontal padding.
- Use thin top and bottom rules for structure.
- Use sharp `1px` borders. Do not round cards, buttons, previews, or panels.
- Cards are not part of the public homepage language. Use rows, rules, and bounded code previews instead.
- Keep the homepage to the two approved sections unless a future issue expands launch content.
- Avoid decorative icons, emoji marks, shadows, gradients, glass, bokeh, and generic SaaS section blocks.

## Components

Navigation:

- Text-only brand and links.
- Persistent top bar with a single bottom rule.
- Active and hover states use brighter text, not color accents.

Links and buttons:

- Core links use sharp bordered text controls.
- Link labels must be specific: "Read spec", "View schema", "GitHub", "Viewer".

Previews:

- Trail previews use compact JSONL with line numbers.
- Syntax emphasis is color-only; no decorative chrome.

Reference implementation rows:

- Show name, package or route label, and status.
- Use `available`, `planned`, and `shell` status words.
- MCP and skills remain planned links until packages or skill directories exist.

## Motion

Motion is minimal and state-based. Use 150 to 200 ms transitions for hover and focus only. Respect reduced motion and do not hide content behind animation.

## Accessibility

Meet WCAG AA contrast at minimum. Body copy on `--color-bg` should use `--color-text`, not `--color-muted`. All interactive elements need visible focus outlines. Do not rely on color alone for status.

## Prohibited Patterns

- Parchment, cream, beige, or paper surfaces for the website.
- Serif or sans font pairings on the website.
- Rounded cards, ghost cards, large soft shadows, gradient text, glass panels, or decorative symbols.
- Adapter matrix or compatibility ledger content on the homepage unless a future issue reintroduces it.
- Marketing claims, metrics blocks, testimonials, newsletter prompts, or hosted-SaaS positioning.
