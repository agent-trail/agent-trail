# Agent Trail

Agent Trail is an open interchange format and tooling ecosystem for coding agent sessions.

The goal is to make sessions from tools like Claude Code, Cursor, Codex CLI, Pi, Aider, and other coding agents portable across viewers, adapters, search tools, and sharing workflows.

## Status

Draft. The current public format target is `0.1.0`.

The repository is a Bun-based monorepo under the `@agent-trail` npm scope. It contains the root format contract, planning docs, schema/types packages, and the first core JSONL parser plus writer-schema record validation slice.

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

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}
{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}
{"type":"agent_message","id":"evta2","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}
```

## Planned Packages

- `@agent-trail/schema`
- `@agent-trail/types`
- `@agent-trail/core`
- `@agent-trail/adapters`
- `@agent-trail/redact`
- `@agent-trail/cli`
- `@agent-trail/website`
- `@agent-trail/mcp` (future)

## Licensing

This repository uses a mixed-license layout.

- The root `LICENSE` is Apache-2.0 for the spec/schema contract.
- Implementation packages will use MIT unless otherwise noted.
- See [`LICENSES.md`](./LICENSES.md) for details.
