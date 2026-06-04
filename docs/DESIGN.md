# Design

## Design Language

Agent Trail adopts a Kami-inspired product language: warm parchment canvas, ink-blue accent, serif-led hierarchy, tight editorial rhythm, and warm gray neutrals. The system should make trail artifacts feel durable and reviewable without turning dense tooling into a print document.

Use strict Kami for public website pages, docs, share pages, one-pagers, release artifacts, and other static presentation surfaces. Use Kami-adapted product mode for the viewer and app UI: keep the palette, editorial restraint, and small-radius geometry, but allow system UI for labels, controls, forms, tables, and dense interaction.

## Color

Use OKLCH tokens in implementation. Do not introduce a second chromatic accent without a specific product reason. OKLCH is available in modern evergreen browsers; provide hex fallbacks first, then override them inside `@supports (color: oklch(0% 0 0))` for older clients.

```css
:root {
  --parchment: #f5f4ed;
  --ivory: #faf9f5;
  --warm-sand: #e8e6dc;
  --border: #e5e3d8;

  --brand: #1b365d;
  --brand-light: #2d5a8a;

  --ink: #141413;
  --muted: #504e49;
  --stone: #595853;
}

@supports (color: oklch(0% 0 0)) {
  :root {
    --parchment: oklch(0.966 0.009 100.0);
    --ivory: oklch(0.982 0.005 95.1);
    --warm-sand: oklch(0.924 0.014 97.5);
    --border: oklch(0.914 0.015 98.3);

    --brand: oklch(0.333 0.077 257.7);
    --brand-light: oklch(0.459 0.093 251.8);

    --ink: oklch(0.191 0.002 106.6);
    --muted: oklch(0.424 0.009 88.7);
    --stone: oklch(0.460 0.009 99.0);
  }
}
```

Color rules:

- Page backgrounds use `--parchment`; raised content uses `--ivory`; toolbars and low-emphasis surfaces use `--warm-sand`.
- Primary text uses `--ink`. Secondary text uses `--muted`; metadata uses `--stone` only when contrast still passes.
- `--brand` is for primary actions, links, focus rings, current navigation, validation highlights, and small editorial rules.
- Avoid cool gray ramps. Warm neutral values should lean toward parchment, not slate.
- Filled brand surfaces use ivory or parchment text, not dark text.

## Typography

Public and document surfaces:

- Use Charter first, then Georgia, Palatino, "Times New Roman", serif.
- If Charter is loaded as a web font, use `font-display: swap` or a fallback-metrics strategy that avoids invisible text and limits layout shift.
- Let the serif carry headings and body. Use 400 for body and 500 for headings.
- Keep body line length around 65 to 75 characters.
- Use balanced wrapping for headings and pretty wrapping for long prose.
- Avoid italics as a default voice. Use emphasis through weight, scale, and spacing.

Kami-adapted product mode:

- Use the serif for page titles, artifact names, summaries, empty states, and explanatory prose.
- Use system UI for small controls, tables, filters, badges, command labels, form fields, and dense metadata.
- Keep type scale tighter than the public site. Product UI should not use fluid hero sizing.

## Layout

Use a 4px spacing base with editorial grouping: tight clusters inside a workflow, more generous space between conceptual sections.

Public pages may use asymmetric editorial layouts, wide text blocks, code/file previews, and artifact diagrams. App and viewer screens should use stable task layouts: sidebars, tabs, split panes, bounded tables, and predictable toolbars.

Cards are allowed only for repeated items, previews, and bounded tools. Do not nest cards. Default radius is 8px; larger radii need a specific presentation use. Prefer borders or whisper shadows, not both as decoration.

## Components

Buttons:

- Primary buttons use `--brand` fill with ivory text.
- Secondary buttons use `--warm-sand` or transparent surfaces with a clear border.
- Button labels use verb plus object.

Panels and previews:

- Trail previews, schema snippets, event timelines, and code blocks should feel like paper artifacts on parchment.
- Use `--ivory` with a fine warm border for static previews.
- Use stronger focus rings and clearer affordances for interactive panels.

Tags and status:

- Tags use solid fills, not translucent overlays.
- Validation, warning, and error states need text labels or icons in addition to color.
- Keep badge shapes compact; avoid pill-shaped decoration when a simple label works.

Tables and timelines:

- Use tabular numbers for token counts, hashes, durations, line numbers, and event counts.
- Preserve row density for scanning.
- Avoid zebra striping unless a table is wide enough to need it.

## Motion

Motion should explain state. Use 150 to 250 ms transitions for hover, focus, selection, expansion, and loading state changes.

Public pages may use restrained entrance motion for artifact reveals or timeline construction. Viewer and app surfaces should load directly into the task.

Every animation needs a reduced-motion path. Do not hide content behind animation-triggered visibility.

## Accessibility

Contrast must meet WCAG AA at minimum: 4.5:1 for normal text and 3:1 for large text. For body text on parchment and ivory, target WCAG AAA at 7:1 when possible. Placeholder text must maintain at least 4.5:1 contrast.

All controls need visible focus states. Tooltips can explain unfamiliar icons, but icon-only controls still need accessible names. Error and warning messages should describe the broken condition and the next action.

## Prohibited Patterns

- Generic SaaS hero metrics, icon-card grids, and soft gradient product chrome.
- AI-purple accents, cool gray dashboards, or blue-slate dark mode by default.
- Beige or parchment surfaces without typographic craft.
- Gradient text, glass panels, decorative bokeh, diagonal stripe backgrounds, and oversized rounded cards.
- Ghost cards that combine a decorative border with a large soft shadow.
- Vague copy such as "AI workflow", "supercharge", "streamline", "next-generation", or "game-changing".
