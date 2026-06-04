# Test Foundation Risk Map

Purpose: harden package contracts before broad refactor. This map names the behavior that must stay stable; tests should target these interfaces rather than private implementation shape.

## Core Package

- JSONL parsing: chunk boundaries, UTF-8 errors, line-aware diagnostics, object-only records.
- Writer-strict validation: `schema.json` remains the format contract; no TypeScript-first drift.
- Reader-tolerant parsing: compatible patch headers, unknown future records, and payload additions are preserved as warnings where allowed.
- Content identity: JCS + LF canonical bytes, session-level hashes, file-level envelope hashes, and two-pass stamping.
- Whole-file graph rules: session group isolation, parent topology, tool-call/result matching, user query response linking, sessions manifest drift.
- Multi-segment reconciliation: `session_uid` grouping, chain warnings, dedupe by event id, late/stable header fields, final restamp.

## Adapter Packages

- Source schema selection: version ranges choose the intended source schema; drift is quarantined, not silently dropped.
- Mapping contracts: raw source records produce canonical event families, stable semantic call ids, and writer-strict entries.
- Parent/tool linking: source call ids and parent ids become Agent Trail topology without crossing session groups.
- Session UID: adapters derive deterministic source-session identities for reconciliation.
- Source raw hygiene: retained raw payloads stay bounded and redacted/sanitized where required.
- Golden fixtures: synthetic source-to-trail pairs protect adapter output through refactor.

## Redact, Store, CLI

- Redaction: raw trails become separate redacted trails; secrets, local paths, and `vcs.remote_url` are removed unless explicitly retained.
- Finalization: redacted bytes are restamped and verify against session and envelope hashes.
- Local store: finalized objects are content-addressed, index rows record `kind`, `session_uid`, and `source_path` correctly, and rebuild can recover metadata from objects.
- CLI flow: `share`, `load`, and `export` compose the same contract as package APIs; network integrations remain stubbed in tests.
- Binary dispatch: `trail` dispatches core verbs and rejects unknown subcommands without relying on inherited object keys.
