# Trail envelope and two-tier identity

The trail file carries file-level concerns (producer, file label, file-scope hash, optional sessions manifest, vendor extensions) on an optional `type:"trail"` record at line 1 — the **trail envelope** — instead of overloading the session header. When the envelope is absent, behaviour is unchanged. When present, the session header MUST follow on line 2, and at most one envelope is allowed per file. This decouples file scope from session scope and reserves the structural slot for future multi-session trails.

Identity becomes two-tier:

- **Session-level `content_hash`** lives on the session header and covers ONLY the session header and its events. Extracting one session from a wrapping file recomputes the same digest — session identity is independent of the envelope.
- **File-level `content_hash`** lives on the envelope and covers the whole file with the envelope's `content_hash` pinned to `<pending>`. The session hash, if present, is treated as opaque file content.

Writers stamp the session hash first, then the file hash. Share/transport tooling verifies the file hash; extraction tooling recomputes the session hash. Both use the same JCS+LF canonicalisation as §7.3.

**Considered Options**

- Add file-level fields to the existing session header (rejected: conflates file and session scope; blocks multi-session files).
- Introduce a sidecar metadata file alongside each trail (rejected: breaks the single-file invariant; complicates sharing).
- Adopt the optional envelope record at line 1 with two-tier identity (chosen).

**Consequences**

- `schema.json` adds a `trailEnvelope` definition and the top-level `oneOf` accepts envelope, header, or entry. Validation dispatches per record type rather than per line position.
- `packages/core/src/graph.ts` detects the envelope, shifts the session header by one position when present, and reports `envelope_not_at_line_1`, `multiple_envelopes`, `missing_header_after_envelope`, and `envelope_sessions_manifest_drift`.
- `packages/core/src/hash.ts` exposes `computeContentHash` / `verifyContentHash` (session scope, slices off the envelope) and `computeTrailEnvelopeContentHash` / `verifyTrailEnvelopeContentHash` (file scope).
- `packages/redact` extends `vcs.remote_url` stripping to envelope records.
- `packages/cli/src/share.ts` stamps both hashes when an envelope is present.
- Deferred for follow-up work: `signature`, `license`, `encryption` envelope fields; multi-session trail files (the `sessions` manifest is validated for length 1 in this draft); writer-side default to emit envelopes is left to per-adapter policy.

Closes #90.
