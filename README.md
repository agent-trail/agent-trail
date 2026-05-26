# Agent Trail

Agent Trail is an open interchange format and tooling ecosystem for coding agent sessions.

The goal is to make sessions from tools like Claude Code, Cursor, Codex CLI, Pi, Aider, and other coding agents portable across viewers, adapters, search tools, and sharing workflows.

## Status

Draft. The current public format target is `0.1.0`.

The repository is a Bun-based monorepo under the `@agent-trail` npm scope. It contains the root format contract, planning docs, schema/types packages, a streaming JSONL parser with layered validation, a redaction module, a content-addressed local store, two source-agent adapters (Pi and Claude Code), and the `trail` CLI (`validate`, `discover`, `list`, `share`, `load`, `export`).

## Core Validation

`@agent-trail/core` validates trail files in `strict` mode by default. Strict validation is the writer-facing profile: records must match the current schema exactly, whole-file graph checks must pass, and a finalized `content_hash` mismatch is an error.

Reader tooling can opt into `{ profile: "reader-tolerant" }` on the core validation APIs. Reader-tolerant parsing preserves compatible future records and unknown payload fields as warnings where safe, accepts compatible `0.1.x` patch headers with a warning, and reports `content_hash` mismatches as warnings. Malformed JSON, invalid hash syntax, graph errors, and non-extension payload shape errors remain errors.

## Repository Map

- [`spec.md`](./spec.md) — Agent Trail format specification.
- [`schema.json`](./schema.json) — canonical writer-strict JSON Schema for trail records.
- [`CONTEXT.md`](./CONTEXT.md) — shared project terminology.
- [`docs/PRD.md`](./docs/PRD.md) — product and implementation plan.
- [`docs/adr/`](./docs/adr/) — durable architecture decisions.

## Format Preview

Minimal trail (session header on line 1):

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}
{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}
{"type":"agent_message","id":"evta2","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}
```

With optional trail envelope (file-level metadata on line 1, session header on line 2):

```jsonl
{"type":"trail","schema_version":"0.1.0","id":"trl-1","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0","name":"OAuth refactor"}
{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}
{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}
```

The envelope is optional and decouples file-scope identity (producer, file label, file-level `content_hash`, optional sessions manifest, vendor `meta`) from per-session metadata. See [`spec.md`](./spec.md) §8.0 and §7.4 for full semantics including two-tier `content_hash` identity.

## Packages

| Package | Purpose |
|---|---|
| `@agent-trail/schema` | Canonical JSON Schema, published to npm. |
| `@agent-trail/types` | Generated TypeScript declarations. |
| `@agent-trail/core` | Streaming JSONL parser, hashing, canonicalization, layered validation, multi-segment reconciler. |
| `@agent-trail/adapters` | Source-agent parsers (Pi and Claude Code today; more pending). |
| `@agent-trail/redact` | Share-time redaction pipeline. |
| `@agent-trail/store` | Content-addressed local object store and index. |
| `@agent-trail/cli` | The `trail` binary. |
| `@agent-trail/website` | Website and web viewer app (`agent-trail.dev`). |

`@agent-trail/mcp` is on the future roadmap and not yet started.

## Licensing

This repository uses a mixed-license layout.

- The root `LICENSE` is Apache-2.0 for the spec/schema contract.
- Implementation packages will use MIT unless otherwise noted.
- See [`LICENSES.md`](./LICENSES.md) for details.
