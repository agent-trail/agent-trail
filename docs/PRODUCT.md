# Product

## Register

product

## Users

Agent Trail serves engineers and tool builders working across multiple coding agents.

Primary users are cross-tool engineers who use tools such as Claude Code, Cursor, Codex CLI, Pi, Aider, and related agents. They need to find, share, review, and move session context without losing the structure of messages, tool calls, results, summaries, and provenance.

Secondary users are tool builders who need a stable interchange target instead of reimplementing adapter and viewer primitives for every agent. Their trust depends on a clear spec, predictable validation behavior, and evidence-backed adapter coverage.

Tertiary users are team leads and researchers who need portable session artifacts for review, recall, audit, or analysis while keeping Agent Trail open infrastructure rather than a hosted SaaS product.

## Product Purpose

Agent Trail is an open interchange format and tooling ecosystem for coding-agent sessions. It normalizes source-agent session storage into portable trail files that can be validated, redacted, shared, loaded, searched, and rendered by generic tools.

Success means Agent Trail becomes the boring, trusted substrate for session portability: writers emit the format, readers tolerate compatible future data, adapters preserve source fidelity honestly, and downstream products can build on the file contract without adopting a proprietary service.

## Brand Personality

Precise, editorial, rigorous.

The brand should feel like paper-like infrastructure: quiet enough to support technical work, crafted enough to make artifacts feel worth keeping, and exact enough for implementers to trust the contract. The voice is concrete and format-first. It favors named artifacts, validation language, and observable behavior over vague AI-product language.

## Anti-references

Agent Trail should not look or sound like generic SaaS chrome, AI-purple tooling, cool gray dashboards, decorative ghost cards, or beige surfaces without craft. Avoid vague "AI workflow" copy, over-polished automation promises, and vertical-product positioning that makes Agent Trail feel like a hosted session manager.

Do not borrow patterns that weaken the product's infrastructure stance: oversized hero metrics, repeated icon-card grids, gradient text, glass panels, decorative shadows, or copy that claims category leadership without showing the format, CLI, schema, or viewer behavior.

## Design Principles

1. Spec-first trust: lead with the format contract, validation model, and artifact identity before decoration.
2. Show the artifact: make trail files, event structure, hashes, adapters, and redaction behavior visible and legible.
3. Tool-builder empathy: explain integration surfaces in the language of schemas, packages, fixtures, and compatibility.
4. OSS pragmatism: keep the product grounded in local files, CLI workflows, and inspectable source.
5. Kami restraint, product discipline: use editorial warmth and serif hierarchy for public surfaces, but keep viewer and app controls efficient.

## Accessibility & Inclusion

Default to WCAG AA contrast or better. Body text, muted text, placeholders, focus states, and disabled states must remain readable on parchment and ivory surfaces.

Support reduced motion. Do not rely on color alone for state, provenance, validation status, warnings, or destructive actions. Keep copy specific enough that screen-reader link and button labels make sense out of context.
