# Agent Trail Specification

**Version:** 0.1.0
**Status:** Draft
**Date:** May 2026
**License:** Apache-2.0
**Schema URL:** `https://agent-trail.dev/schema/v0.1.0.json` *(release snapshot; local source: `schema.json`)*

---

## 1. Motivation

Engineers using multiple coding agents lose continuity between them. A debugging session in Claude Code is invisible from Cursor; an Aider conversation can't be shared with a colleague using Pi. Each tool stores sessions in its own format, and tools that try to bridge them re-implement the same parsing work.

Agent Trail defines a portable file format for coding agent sessions, so any compliant tool can read and share sessions produced by any other.

---

## 2. Goals and non-goals

### Goals

- Map common coding agents to one canonical event vocabulary with acceptable fidelity (~70%+ semantic fit on average across supported agents).
- Renderable in a generic viewer with no source-agent code.
- Searchable with standard text tooling.
- Trivially streamable, line by line.
- Trivially versionable, with graceful reader degradation.
- Content-addressable for safe sharing and deduplication.

### Non-goals

- Replacing agents' native storage formats.
- Bit-perfect reproduction of source sessions. Use `source.raw` if needed.
- Encoding model internals (logits, sampling parameters, tokens).
- Cryptographic signing (deferred).
- Multi-file sessions (deferred).
- Real-time bidirectional sync between agents.

---

### 2.1 Conformance and normativity

The normative Agent Trail contract is this specification plus `schema.json`.
`schema.json` is the canonical writer-strict machine-readable contract through
v1.0.

The key words "MUST", "MUST NOT", "REQUIRED", "SHOULD", "SHOULD NOT", and "MAY"
are to be interpreted as described in BCP 14 when, and only when, they appear in
all capitals.

Examples, notes, rationale, implementation guidance, adapter mappings, reader
display choices, CLI behavior, store layout, and redaction workflow are
non-normative unless explicitly stated otherwise. Implementation guidance lives
in `docs/implementation-semantics.md`.

---

## 3. At a glance

The smallest valid Agent Trail file:

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}
{"type":"user_message","id":"01HEVTA0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}
{"type":"agent_message","id":"01HEVTA0000000000000000002","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}
```

Line 1 is the header. Lines 2 and on are events. Everything else is optional structure layered on top.

---

## 4. Terminology

| Term | Definition |
|---|---|
| **Trail file** | A JSONL file conforming to this specification; contains one or more session groups. |
| **Trail envelope** | Optional `type:"trail"` record at line 1 carrying file-level metadata (producer, file label, file-scope hash, manifest, vendor extensions). Not part of the event graph. |
| **Header** | The session header (`type:"session"`). On line 1 when there is no envelope, on line 2 when the envelope is present. Not part of the event graph. |
| **Session group** | One `type:"session"` header plus the events after it until the next session header or EOF. |
| **Session bundle** | A trail file with one or more session groups. At session-group level the bundle is a forest; each group may itself be linear or tree-native. |
| **Child session** | A separate session group or external session spawned or forked from another session, linked by the child header's `fork_from`. |
| **Event** | Any object after the header line; one unit of session content. |
| **File-level content hash** | SHA-256 of the canonical bytes covering the whole file with the trail envelope's `content_hash` pinned to `<pending>`. |
| **Session-level content hash** | SHA-256 of the canonical bytes covering ONLY the session header and its events (envelope excluded), with the session header's `content_hash` pinned to `<pending>`. |
| **Entry** | Equivalent to "event"; either term may appear. |
| **Adapter** | Software that reads a source agent's storage and emits a trail file. |
| **Linear session** | A session whose events do not use `parent_id`. Events are ordered by file position. |
| **Tree session** | A session where some events use `parent_id` to form a DAG. |
| **Canonical event** | One of the mandatory or optional event types in [§9.2](#9-2-mandatory-event-types) and [§9.3](#9-3-optional-event-types). |
| **Raw trail** | A local artifact preserving source fidelity as much as possible. |
| **Redacted trail** | A separate artifact produced from a raw trail for sharing. It has its own `content_hash`. |
| **Shared trail** | A redacted trail transported through a sharing mechanism. |
| **Synthesized event** | An event the adapter constructed from indirect source data (e.g., a git diff), not mapped from a real source event. Flagged with `source.synthesized: true`. |
| **Content hash** | SHA-256 of the exact artifact's canonical bytes (§7). |
| **Canonical bytes** | The file content normalized per §7 for hashing. |
| **Source escape hatch** | The `source.raw` field; preserves verbatim source-format data for lossless round-trip. |

---

## 5. File format

### 5.1 File extension and MIME type

- Recommended extension: `.trail.jsonl`
- MIME type: `application/vnd.trail+jsonl`. The `vnd.` form is the intended canonical type and follows IANA conventions for vendor MIME types. IANA registration is deferred to v1.0; until then the type is documented here but not officially registered.
- Editors render as JSON via the `.jsonl` suffix. A dedicated language extension may provide richer highlighting later.

### 5.2 Encoding

- UTF-8, no BOM.
- LF line endings (`\n`). CRLF is tolerated by readers; writers must not produce it.
- Each line is one self-contained JSON object.
- Empty lines are not allowed.
- A trailing newline at EOF is recommended but not required.
- Writers MUST replace invalid UTF-8 bytes and unpaired surrogate escapes with U+FFFD at emission time. Emitted JSON strings MUST NOT contain unpaired surrogates.

### 5.3 File layout

Every valid trail file has:

1. **Optionally**, a trail envelope (`type:"trail"`) on line 1 (§8.0).
2. One **or more** session header groups in file order. Each group starts with a `type:"session"` record and continues with zero or more event lines until the next `type:"session"` record or EOF (§8.6). The first session header MUST appear on line 1 when there is no envelope, or on line 2 when an envelope is present.

When the file contains exactly one group, behaviour is unchanged from earlier drafts. Multi-group ("multi-session") files are described in §8.6.

---

## 6. Versioning

The header's `schema_version` is a SemVer string. The current version is `"0.1.0"`. Writers must emit the exact version they conform to.

Agent Trail uses SemVer for the interoperability contract:

| Change type | Version bump | Examples |
|---|---|---|
| Editorial-only change | no bump or patch | Typos, formatting, non-normative wording, examples that do not change validity or semantics. |
| Normative clarification with no behavior change | patch | Resolving ambiguity while preserving the same valid files and reader behavior. |
| Backward-compatible feature addition | minor | New optional field, new optional event type, new registered agent or tool kind that readers may ignore. |
| Breaking change | major | Required field changes, field removal, incompatible meaning changes, or changes that make existing valid trails invalid. |

Before `1.0.0`, Agent Trail still uses this compatibility discipline conservatively:

- `0.1.x` versions are the same feature family. Readers that support `0.1.0` should accept later `0.1.x` patch versions.
- `0.2.0` and later `0.x` versions may add backward-compatible features. Readers may accept them best-effort by skipping unknown event types and ignoring unknown payload fields.
- Breaking changes should be avoided before real adapter and reader experience proves they are necessary. If unavoidable, they must get a new minor while the spec is still pre-1.0, and the changelog must mark them explicitly as breaking.
- `1.0.0` is reserved for the first stable interoperability contract.

Published spec and schema URLs are immutable. Local source files (`spec.md` and `schema.json`) represent the current working draft or next release candidate; released snapshots live at versioned URLs such as `/spec/v0.1.0` and `/schema/v0.1.0.json`.

Writer schemas are exact per release: the v0.1.0 writer schema requires `schema_version: "0.1.0"`. Reader tolerance is runtime behavior, not permission for writers to emit a version other than the release they implement.

| Source version | Reader behavior |
|---|---|
| Same `major.minor`, any patch | Fully supported if the reader supports that feature family. |
| Newer `0.x` minor | Best-effort: skip unknown event types, ignore unknown payload fields, preserve unknown records when round-tripping, and warn instead of aborting where possible. |
| New major version | Readers may reject unless they explicitly support that major version. |

---

## 7. Identity, artifacts, and content addressing

### 7.1 Session identity

Every session has a local identifier `id` in the header. Writers emit uppercase ULIDs (26 Crockford base32 chars) or lowercase UUIDs (RFC 4122, hyphenated or unhyphenated). The schema enforces this canonical casing so cross-segment reconciliation can dedup events by exact string equality; older v0.1 fixtures whose ids were free-form strings or non-canonical casing have been migrated.

### 7.2 Artifact classes

Agent Trail distinguishes local fidelity from shared safety:

- **Raw trail:** the local artifact emitted by an adapter. It should preserve source fidelity, including `source.raw` where useful and safe.
- **Redacted trail:** a separate artifact produced from a raw trail for sharing. It removes or normalizes sensitive content and has its own `content_hash`.
- **Shared trail:** a redacted trail transported by a share tool.

Redacted artifacts may include `redacted_from.content_hash` in the header to record provenance from the raw artifact. They must not expose the raw artifact's local path or local session identifier.

### 7.3 Content hash

Finalized artifacts should populate `content_hash` in the header. This is the SHA-256 of the artifact's canonical bytes, not a hash of the physical on-disk serialization and not a logical-session identifier shared across raw and redacted variants.

Canonical bytes are defined as:

- All JSONL lines in order.
- LF line endings.
- No trailing whitespace.
- A trailing newline at EOF.
- Each JSON object serialized using RFC 8785 JSON Canonicalization Scheme (JCS).
- Writer-valid strings are well-formed per §5.2, so canonical bytes remain pure JCS; hash-time string repair is not part of this procedure.

Because the hash depends on the file content that includes the hash field, we use a two-pass approach:

1. Serialize the file with the header's `content_hash` field set to the literal `"<pending>"`.
2. Canonicalize per the rules above.
3. Compute SHA-256 of the canonicalized bytes.
4. Replace only the header's `content_hash` field with the resulting hex digest.

Verifying a file's hash uses the same procedure: replace the present hash with `"<pending>"`, canonicalize, hash, compare.

Writers that produce streaming or in-progress files may omit `content_hash` or leave it as `"<pending>"`. Readers may verify the hash but must not abort on mismatch — only warn. Strict validators must report a present but incorrect finalized `content_hash` as an error.

### 7.4 Two-tier identity

When a trail envelope is present, the file carries two independent content hashes:

- **Session-level `content_hash`** lives on the session header. It is SHA-256 over the canonical bytes covering only the session header and its events (the envelope record is excluded from the hashed input). In a multi-session file (§8.6) the slice for a session covers that session's header and the events between it and the next `type:"session"` record (or EOF). This makes each session's identity independent of whether it is wrapped in an envelope or sits beside sibling sessions — extracting one session from a multi-session file recomputes the same digest.
- **File-level `content_hash`** lives on the trail envelope. It is SHA-256 over the canonical bytes of the whole file, with the envelope's `content_hash` field replaced by `"<pending>"` per the same two-pass procedure as §7.3. The session-level `content_hash`, if already populated, is treated as opaque file content.

Writers that emit both hashes MUST stamp every session-level hash first, then compute and stamp the file-level hash. Readers verify them independently. Different consumers care about different scopes: extraction tools recompute the session hash; share/transport tools verify the file hash.

#### 7.4.1 Hash tier for `fork_from` and `redacted_from`

Lineage references mirror the tier of the linking context:

- **Header-level `fork_from.content_hash` and `redacted_from.content_hash`** refer to the **session-level** `content_hash` of the parent artifact (the forked-from session or the raw session that was redacted). This keeps session lineage independent of any envelope wrapper — extracting either side recomputes the same digest.
- **Envelope-level `fork_from.content_hash` and `redacted_from.content_hash`** refer to the **file-level** `content_hash` of the parent file (envelope and all sessions included). Use these to link whole files rather than individual sessions.
- `segment.prev_content_hash` (§8.5) is always session-level, since segments chain at session grain.

Writers MUST choose the matching tier; mixing tiers across a chain breaks verification.

### 7.5 Event identifiers

Event `id` values are globally unique. Writers emit uppercase ULIDs or lowercase UUIDs, matching §7.1 and the schema. Globally-unique canonical ids let a reconciler dedup events across segments by exact string equality.

---

## 8.0 The trail envelope

The trail envelope is an OPTIONAL record on line 1 that carries file-scope metadata distinct from per-session metadata. When absent, the session header occupies line 1 and behaviour matches earlier drafts. When present, the session header MUST follow on line 2 and at most one envelope is permitted per file.

### 8.0.1 Schema

```jsonc
{
  "type": "trail",
  "schema_version": "0.1.0",
  "id": "<file-uuid-or-ulid>",
  "name": "<human-label>",                          // optional
  "description": "<free text>",                     // optional
  "ts": "<ISO-8601 timestamp>",
  "producer": "trail-cli/0.3.0",
  "content_hash": "<sha256-hex>",                   // optional; populated at finalize
  "tags": ["..."],                                  // optional
  "vcs": { "type": "git", "revision": "..." },      // optional; same shape as §8 vcs
  "fork_from": {                                    // optional; file-level fork link
    "trail_id": "<parent-file-id>",                 // UUID or ULID id
    "content_hash": "<parent-file-hash>"            // optional
  },
  "redacted_from": {                                // optional; redacted artifacts only
    "content_hash": "<raw-file-content-hash>"
  },
  "sessions": [                                     // optional manifest
    { "id": "<session-id>", "agent": "<canonical-name>" }
  ],
  "meta": {                                         // optional; see §8.0.3
    "io.entire.checkpoint_id": "ckpt-7"
  }
}
```

### 8.0.2 Fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | literal `"trail"` | discriminator |
| `schema_version` | yes | string | currently `"0.1.0"` for the envelope shape — independent of session `schema_version` |
| `id` | yes | string | file-level identifier; distinct from any session `id` in the file |
| `name` | no | string | human label |
| `description` | no | string | free text |
| `ts` | yes | string | ISO-8601 timestamp when the file was assembled or exported |
| `producer` | yes | string | identifier of the writer (e.g., `trail-cli/0.3.0`) |
| `content_hash` | no | string | SHA-256 hex of the whole-file canonical bytes; see §7.4 |
| `tags` | no | string[] | free-form labels |
| `vcs` | no | object | working-tree context at file-assembly time |
| `fork_from` | no | object | reference to a parent file when forked; `trail_id` is a UUID or ULID id and `content_hash` is optional |
| `redacted_from` | no | object | provenance link from a redacted file to its raw counterpart |
| `sessions` | no | array | manifest of sessions in this file; validator warns on drift vs file content |
| `meta` | no | object | free-form vendor extensions (§8.0.3) |

The envelope MUST NOT carry a `parent_id`. It is not part of the event graph.

### 8.0.3 The `meta` extension convention

The trail envelope (§8.0), the session header (§8), and every event entry (§9.1) accept an optional `meta` object for vendor extensions, modelled on OCI image annotations and Kubernetes `metadata.annotations`. Object-typed values are allowed so nested data fits naturally. Keys SHOULD use a reverse-DNS or `x-<adapter>/` namespace to avoid collisions (`com.example.team`, `x-acme/build_id`, `io.entire.checkpoint_id`). The validator treats `meta` as opaque; it contributes to whichever `content_hash` tier covers its host record (§7.4): `meta` on the session header or any event entry feeds the session-level hash, and `meta` on the trail envelope feeds the file-level hash.

For verbatim source-event preservation, use `source.raw` ([§9.1](#9-1-base-shape), [§9.7](#9-7-source-envelope-referencing), [§14.1](#14-1-source-raw-elision-and-redaction)) instead — `meta` is for cross-cutting annotations, not for capturing the source envelope.

This draft defines one standard event-entry `meta` key: `redaction_count` (§15). Other standard keys may be promoted in later minor bumps based on observed usage.

### 8.0.4 The `sessions` manifest

When `sessions` is present, the validator warns if the manifest disagrees with the file:

- The manifest MUST list one entry per session group (§8.6) in file order. Each entry's `id` and `agent` MUST match the corresponding session header's `id` and `agent.name`. Length mismatch and per-entry drift both emit `envelope_sessions_manifest_drift` warnings — never errors, so renderers can still display the file.
- The manifest is an index/rendering hint only. It MUST NOT carry graph facts such as child-session role or follows edges; session headers are authoritative for lineage.

### 8.0.5 File identity defaults when envelope is absent

When no envelope is written, file-level identity defaults derive from the session:

- File `id` = session `id`.
- File `name` is unset.
- The file-level content hash is unavailable; only the session content hash is meaningful.

## 8. The session header

### 8.1 Schema

```jsonc
{
  "type": "session",
  "schema_version": "0.1.0",
  "id": "<session-uuid-or-ulid>",
  "name": "<session-title>",                       // optional
  "description": "<free-text-description>",        // optional
  "tags": ["feature", "debug"],                    // optional
  "content_hash": "<sha256-hex>",               // optional; populated at finalize
  "ts": "<ISO-8601 timestamp>",
  "stream": {                                   // optional; live-capture marker (§8.4)
    "state": "open" | "closed",
    "started_at": "<ISO-8601 timestamp>"        // optional
  },
  "agent": {
    "name": "<canonical-agent-name>",
    "version": "<source-agent-version>",        // optional
    "model_default": "<model-id>"               // optional
  },
  "cwd": "<absolute-path-or-normalized>",       // optional
  "vcs": {                                      // optional
    "type": "git" | "jj" | "hg" | "svn" | "x-<vendor>/<name>",
    "revision": "<sha-or-change-id>",
    "remote_url": "<canonical-remote-url>"      // optional; see §8.2
  },
  "fork_from": {                                // optional
    "session_id": "<parent-session-id>",
    "content_hash": "<parent-content-hash>",    // optional
    "entry_id": "<parent-entry-id>"             // optional
  },
  "redacted_from": {                            // optional; redacted artifacts only
    "content_hash": "<raw-artifact-content-hash>"
  },
  "parse_fidelity": {                           // optional; at-a-glance parse summary
    "quarantined_count": 0,
    "termination_reason": "truncated"           // optional; when session_terminated exists
  },
  "source": {                                   // optional
    "agent": "<canonical-agent-name>",
    "path": "<original-file-path>",
    "format_version": "<source-format-version>"
  },
  "meta": {                                     // optional; vendor extensions (§8.0.3 / §11)
    "com.example.custom_field": "..."
  }
}
```

### 8.2 Fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | literal `"session"` | discriminator |
| `schema_version` | yes | string | currently `"0.1.0"` |
| `id` | yes | string | UUID or ULID per §7.1/§17 |
| `name` | no | string | human session label |
| `description` | no | string | free-text session description |
| `tags` | no | string[] | free-form session labels |
| `content_hash` | no | string | SHA-256 hex of this artifact; see §7.3 |
| `ts` | yes | string | ISO-8601 session start time; writers emit UTC `Z` with millisecond precision |
| `stream` | no | object | live-capture marker; see §8.4 |
| `agent.name` | yes | string | from the canonical registry (§13) |
| `agent.version` | no | string | source agent's version |
| `agent.model_default` | no | string | default model for the session |
| `cwd` | no | string | working directory; may be normalized for privacy |
| `vcs` | no | object | version control context at session time |
| `vcs.type` | yes (if `vcs` present) | enum or extension | `git`, `jj`, `hg`, `svn`, or `x-<vendor>/<name>` for non-reserved systems |
| `vcs.revision` | yes (if `vcs` present) | string | commit SHA, change-id, or revision identifier |
| `vcs.remote_url` | no | string | canonical remote URL identifying the project across users, machines, and clones; see normalization rules below |
| `vcs.branch` | no | string | active branch / bookmark / topic name the session is running on (e.g., `feature/x`). Detached-HEAD sessions MAY omit. |
| `vcs.head_commit` | no | string | commit hash at session start (lowercase hex, 7–64 chars). For git, typically equals `vcs.revision`; the explicit field exists as a vcs-neutral alias. |
| `vcs.worktree` | no | object | worktree context when the session ran inside a working-tree clone or worktree (git worktree, jj workspace, etc.) |
| `vcs.worktree.name` | yes (if `vcs.worktree` present) | string | worktree short name |
| `vcs.worktree.path` | yes (if `vcs.worktree` present) | string | absolute path to the worktree |
| `vcs.worktree.original_cwd` | no | string | working directory of the parent repository at worktree-creation time |
| `vcs.worktree.original_branch` | no | string | branch the parent repository was on when the worktree was created |
| `vcs.worktree.original_head_commit` | no | string | commit the worktree was forked from (lowercase hex, 7–64 chars) |
| `fork_from` | no | object | reference to a parent session if forked |
| `redacted_from` | no | object | provenance link from a redacted artifact to the raw artifact hash |
| `parse_fidelity` | no | object | at-a-glance parse fidelity summary; absence means the writer did not provide a summary |
| `parse_fidelity.quarantined_count` | yes (if `parse_fidelity` present) | integer | number of `system_event` entries whose `payload.kind` is `x-*/unknown_record` in this session group |
| `parse_fidelity.termination_reason` | no | enum | final `session_terminated.payload.reason`, when a `session_terminated` event is present |
| `source` | no | object | source-file metadata block (agent, path, format_version) |
| `meta` | no | object | vendor extensions; recommended keys use the reverse-DNS / `x-<adapter>/` convention (§8.0.3 / §11) |

When `parse_fidelity` is present, validators MUST compare it against the session group's entries. `quarantined_count` MUST equal the count of quarantined unknown source records emitted as `system_event` entries with `payload.kind` matching `x-*/unknown_record`. `termination_reason`, when a `session_terminated` entry exists, MUST match the final `session_terminated.payload.reason`; if no `session_terminated` entry exists, writers MUST omit `termination_reason`. This field is denormalized for cheap listing/filtering only; the event stream remains authoritative. Quarantined records are suspect parse fidelity, not necessarily lossy, because the raw source record is preserved.

`vcs.remote_url` provides a canonical project identifier that survives across users, machines, and clones — useful for cross-machine aggregation, profile filtering, and project-scoped analysis. Adapters that populate it:

- MUST normalize SSH and HTTPS variants of the same repository to a single canonical form. The reference normalization maps `git@host:org/repo.git`, `ssh://git@host/org/repo.git`, and `https://host/org/repo.git` to `https://host/org/repo` (strip trailing `.git`, strip userinfo, rewrite SSH to HTTPS).
- MUST strip embedded credentials (`https://user:pass@host/...` → `https://host/...`) before emission.
- SHOULD populate when the source agent records repository location or when `cwd` is detectably a versioned working directory. When the source declares multiple remotes (e.g., git `origin` plus `upstream`), prefer `origin`.
- MUST omit the field when no remote is configured — do not fabricate one.
- For submodules and worktrees, emit the remote of the outermost working tree's toplevel; `cwd` and `vcs.revision` disambiguate within.

Privacy: `remote_url` reveals repository identity and may identify a private repo. Redacted artifacts may strip or normalize it (§15).

When a trail file carries both header-level `vcs` (session-time context) and envelope-level `vcs` (file-assembly-time context, §8.0), they represent different observation points. File-assembly tools SHOULD preserve both when present. For multi-segment reconciliation rules, see §8.5.

### 8.3 Example

```json
{"type":"session","schema_version":"0.1.0","id":"01HM7K5R9X2QZJ8VD6W4P3T1F0","content_hash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","ts":"2026-05-17T14:02:00.000Z","agent":{"name":"claude-code","version":"2.1.42","model_default":"claude-sonnet-4-5"},"cwd":"<cwd>","vcs":{"type":"git","revision":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"}}
```

### 8.4 Streaming and live capture

JSONL is append-friendly by design: trail files can be written event by event as a session unfolds, and readers can `tail -f` them. v0.1.x adds an explicit marker so writers and readers can agree on live-capture state without overloading other header fields.

The optional header `stream` object:

| Field | Required | Type | Notes |
|---|---|---|---|
| `stream.state` | yes (if `stream` present) | enum | `open` while the writer is actively appending; `closed` once finalized |
| `stream.started_at` | no | string | ISO-8601 timestamp when the stream began; matches the §8 `ts` semantics |

Lifecycle:

1. **Live phase.** Writer emits the header with `stream: { state: "open" }`. `content_hash` is omitted or set to `"<pending>"`. Events are appended as they happen.
2. **Finalize.** Writer rewrites the header with `stream` either removed or set to `state: "closed"`, then computes `content_hash` per §7.3. Appending stops.
3. **Clean end.** Writer may append a `session_end` event (§9.3) to mark a normal conclusion before finalize. Abnormal ends still use `session_terminated`.

Tail readers that observe `stream.state == "open"` should assume more events may arrive. Readers observing `stream` absent or `state == "closed"` should treat the file as a finalized artifact and verify `content_hash` when present.

`stream` is absent in trail files produced by stream-unaware writers; readers must treat that case as equivalent to a finalized non-streaming artifact (existing v0.1.0 behavior).

A live `system_event` heartbeat convention is described in §9.3.

---

### 8.5 Session segments (multi-segment sessions)

A single logical source session MAY be split across multiple trail-file artifacts — "segments" — when a long-running session is captured in chunks (e.g., a daemon writing periodically) or recovered after a writer is killed mid-session. The header carries three fields that let a reconciler group, order, and verify segment chains. All three are optional in v0.1; a single-segment trail simply omits them.

- `session_uid` — globally-unique source-session identifier. Stable across **all** segments of one source session. Reconcilers group segments by exact string equality on `session_uid`. Format: uppercase ULID (recommended, lexicographic time-prefix) or lowercase UUID (any RFC 4122 version, hyphenated or unhyphenated). Writers SHOULD emit `session_uid` even for single-segment trails, so a later segment can be reconciled against the first without rewriting the head. The schema enforces `session_uid` as required when `segment.seq >= 2` (multi-segment continuation MUST be linkable).

- `segment.seq` — 1-based integer identifying which segment of the session this file is. Single-segment trails MAY omit `segment` entirely, which is equivalent to `{seq: 1}`.

- `segment.prev_content_hash` — the **session-level** `content_hash` (§7.3) of the previous segment's finalized bytes. Required when `seq >= 2`. Forms a verifiable chain (HLS / Postgres-WAL pattern). If the previous segment was lost and the chain cannot be verified, writers MAY emit `null` and readers MUST emit a `segment_chain_break` warning.

#### Segment reconciliation

Segment reconciliation is implementation behavior. A conforming writer emits the
fields above; a conforming reader can validate each segment independently. Tools
that merge segments SHOULD preserve event order by `segment.seq`, verify
`segment.prev_content_hash` where present, deduplicate exact event `id` matches,
and emit a new finalized trail with freshly computed hashes.

Implementation merge policy is documented in `docs/implementation-semantics.md`.

Whole-file graph rules (§16) apply **within** a segment, not across. Cross-segment references are out of scope for v0.1 (event `parent_id` chains do not span segments).

#### Writer guidance

- Writers SHOULD generate `session_uid` once per source session and reuse it for every segment.
- Writers SHOULD finalize each segment normally before starting a new segment.
- To produce `segment.prev_content_hash` for segment N, finalize segment N-1 per §7.3 and copy its session-level `content_hash` verbatim into segment N's header.
- Recovered writers MAY emit `segment.prev_content_hash: null` when the previous segment is lost.

#### Composition with multi-session files

`session_uid` and `segment.*` sit at the **session-header** grain, not the file grain. A multi-session trail file (§8.6) may contain N session headers, each independently multi-segmentable. The trail envelope (§8.0) is unaffected.

---

### 8.6 Multi-session trail files

A trail file MAY contain one OR more `(session header, events*)` groups concatenated. Boundaries are positional: a group extends from a `type:"session"` record up to (but excluding) the next `type:"session"` record, or to EOF. Single-session trails are the N=1 case and are unchanged.

A multi-session trail is a session bundle: a forest of session groups. Each group may be linear or tree-native. Branches represented inside one source session use `parent_id` within that group; separate spawned or forked transcripts use separate groups linked by `header.fork_from`.

#### 8.6.1 File grammar

```text
trail-file := envelope? group+
envelope   := <one JSONL record with type:"trail"> on line 1
group      := <one JSONL record with type:"session"> events*
events     := zero or more event records (§9)
```

The trail envelope (§8.0) remains optional even when N ≥ 2. When present with N ≥ 2 groups, the file-level `content_hash` on the envelope covers all N groups' already-stamped session hashes, applying the §7.4 two-pass procedure unchanged (every session hash stamped first; envelope hash stamped over the finalized record set). When absent, file-level identity defaults from §8.0.5 apply (no file-level `content_hash` is meaningful; only per-session hashes).

#### 8.6.2 Group boundaries and reader-tolerant recovery

Readers detect group boundaries by `type:"session"` alone. A record with `type:"session"` always opens a new group, regardless of `schema_version` value: this lets reader-tolerant parsers (§6) recover from a malformed mid-file header and continue parsing subsequent groups instead of treating the rest of the file as orphan events. The strict validator still errors on individual records that fail schema validation; recovery affects parsing structure, not per-record validity.

Entries that appear before the first `type:"session"` record (and after any envelope) are not part of any group and are always invalid: `events_before_first_session_header`.

#### 8.6.3 Per-group validation

Whole-file graph rules (§16) apply **within** a group, not across:

- `parent_id` resolution is scoped to the enclosing group. A `parent_id` that references an `id` in another group is treated as `unknown_parent_id` (cross-group references go through `fork_from`, not `parent_id`).
- `tool_call` / `tool_result` pairing (§9.5) runs per group. An unmatched `tool_call` in group A is not satisfied by a `tool_result` in group B.
- `session_end.payload.final_message_id`, `source.raw.envelope_ref`, `payload.usage` checks, and the `stream` consistency rule each run per group.

Event `id` uniqueness (§7.5) remains **file-scoped**: every `id` (across every group's header and events) MUST be unique within the file.

#### 8.6.4 Per-group `content_hash`

Each group's session-level `content_hash` is computed over the canonical bytes of that group's slice only (header + its events, envelope and sibling groups excluded). This is the same procedure as §7.3 / §7.4 applied to the slice. As a consequence, extracting one session from a multi-session file (drop the envelope, drop sibling groups, write only that group's canonical bytes) reproduces the same digest as the in-file value.

When a reader extracts a single session from a multi-session file outside writer-strict validation and the recomputed `content_hash` does not match the value stored in the in-file header, it SHOULD emit a warning rather than an error. Strict validation of a finalized trail file still treats an in-place finalized `content_hash` mismatch as an error (§16.4).

#### 8.6.5 Cross-group references

The only sanctioned cross-group reference primitive is the session header's `fork_from`:

- `fork_from.session_id` MAY reference a sibling session within the same file or an external session.
- When `fork_from.session_id` matches a sibling's `id` in the same file and `fork_from.content_hash` is also present, the hash MUST match that sibling's session-level `content_hash`. Mismatch is a `cross_group_fork_from_hash_mismatch` warning.
- External references (`session_id` not matched in-file) are not validated here; if the referenced session's bytes are available, callers may verify the hash through their own resolver.

`parent_id` is event-graph topology only and MUST NOT span groups.

#### 8.6.6 Order, divergence, and per-session metadata

- Sessions in a file SHOULD appear in chronological order by header `ts`. Out-of-order placement emits `out_of_order_session_headers` (warning, not error).
- Per-session `cwd` and `vcs` MAY diverge across sessions in the same file. Divergent `vcs.revision` across groups emits `vcs_revision_divergence` (warning, not error) — useful for spotting accidental cross-checkout bundling.
- `schema_version` is carried on every session header. Sessions in the same file are independently versioned (reader-tolerant patch acceptance per §6 applies per-header).
- Empty groups (a header with zero events) are legal — they represent "session started, nothing happened."

#### 8.6.7 Redaction of multi-session files

Redacting a multi-session trail produces a multi-session redacted trail with the same group count in the same order, redacted in place. The redactor resets `content_hash` to `<pending>` on every session header (and on the envelope when present) before share/transport tooling re-stamps via the two-pass §7.4 procedure. Header-level `redacted_from.content_hash` links the redacted session to its raw counterpart; envelope-level `redacted_from.content_hash` links the redacted file to its raw counterpart.

#### 8.6.8 No hard cap

This spec does not impose a maximum on the number of session groups per file. Consumers may apply their own limits.

---

## 9. Events

### 9.1 Base shape

Every event entry has this base shape:

```jsonc
{
  "type": "<event-type>",
  "id": "<entry-id>",
  "parent_id": "<entry-id>",                    // optional; tree topology only
  "ts": "<ISO-8601 timestamp>",
  "payload": { /* type-specific */ },
  "semantic": {                                 // optional; see §9.4
    "group_id": "<group-id>",
    "call_id": "<source-call-id>",
    "tool_kind": "<canonical-tool-kind>"
  },
  "source": {                                   // optional
    "agent": "<canonical-agent-name>",
    "original_type": "<source-event-name>",
    "schema_version": "<source-schema-version>",
    "raw": { /* opaque source object; see §9.6 and §14 */ },
    "synthesized": false
  },
  "meta": {                                     // optional; vendor extensions (§8.0.3 / §11)
    "com.example.field": "..."
  }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | string | event type; see §9.2-9.3 |
| `id` | yes | string | globally unique; ULID or UUID per §17 |
| `parent_id` | no | string | references another `id` for tree topology; absent = linear file order |
| `ts` | yes | string | ISO-8601 timestamp |
| `payload` | yes | object | type-specific data |
| `semantic` | no | object | linking metadata for fallback pairing |
| `source` | no | object | adapter-provided source metadata |
| `meta` | no | object | vendor extensions (§8.0.3 / §11) |

### 9.2 Mandatory event types

Every adapter must be able to emit these when the source data contains the corresponding semantics. Readers must support them.

#### `user_message`

A message from the human user.

```jsonc
{
  "type": "user_message",
  "id": "...",
  "ts": "...",
  "payload": {
    "text": "How do I parse a CSV in Python?",
    "attachments": [
      { "kind": "image", "media_type": "image/png", "uri": "<inline-or-ref>" }
    ]
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `text` | yes | string | the user's input |
| `attachments` | no | array | images or files by reference |

Attachment entries require `kind` plus at least one of `uri` or `name`. `uri` values in v0.1.0 are references, not inline binary payloads. Writers may use `https:`, local `file:` references for private/local trails, or content-addressed references such as `sha256:<hex>`. Inline `data:` payloads are deferred.

#### `agent_message`

A text response from the agent.

```jsonc
{
  "type": "agent_message",
  "id": "...",
  "ts": "...",
  "payload": {
    "text": "You can use pandas:",
    "model": "claude-sonnet-4-5",
    "stop_reason": "end_turn",
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 567,
      "cache_read_tokens": 100,
      "cache_creation_tokens": 50,
      "reasoning_tokens": 200,
      "context_input_tokens": 1384,
      "context_window_tokens": 200000
    }
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `text` | yes | string | the agent's output |
| `model` | no | string | model that produced this message |
| `stop_reason` | no | string | source-specific stop reason |
| `usage` | no | object | token usage for the source envelope; see below |
| `attachments` | no | array | agent-side images or files by reference (e.g. a generated chart or vision output); same object shape as `user_message.payload.attachments` |

`attachments[]` entries share one object shape across `user_message`, `agent_message`, and `tool_result` (`kind` ∈ `image`/`file`/`other`, optional `media_type`, and at least one of `uri` or `name`). The same v0.1.0 `uri` reference policy applies: `https:`, local `file:`, or content-addressed `sha256:`; inline `data:` payloads are deferred.

##### `agent_message.payload.usage`

Captures token accounting emitted by the source agent for a model-response envelope. Optional. When the source provides no token data, writers MUST omit `usage` — fabricating zeros is not allowed.

| Sub-field | Required | Type | Notes |
|---|---|---|---|
| `input_tokens` | conditional | integer ≥0 | delta for this envelope |
| `output_tokens` | conditional | integer ≥0 | delta for this envelope |
| `input_tokens_cumulative` | conditional | integer ≥0 | running total through this envelope |
| `output_tokens_cumulative` | conditional | integer ≥0 | running total through this envelope |
| `cache_read_tokens` | no | integer ≥0 | input tokens served from prompt cache; billed separately from `input_tokens` |
| `cache_creation_tokens` | no | integer ≥0 | input tokens written to prompt cache; billed separately from `input_tokens` |
| `reasoning_tokens` | no | integer ≥0 | output reasoning portion (Anthropic thinking, OpenAI reasoning) |
| `context_input_tokens` | no | integer ≥0 | prompt/context tokens submitted to the model for this request; cache-inclusive when the source exposes enough detail |
| `context_window_tokens` | no | integer ≥1 | model context-window size for this request, only when the source exposes it |

When `usage` is present, writers MUST emit at least one of (`input_tokens`, `input_tokens_cumulative`) AND at least one of (`output_tokens`, `output_tokens_cumulative`). Both shapes are supported because sources differ. Readers SHOULD prefer the delta form and fall back to subtracting consecutive cumulative values.

Cache token semantics: `input_tokens` counts non-cached input only; `cache_read_tokens` and `cache_creation_tokens` are independent billing categories. Total billed input = `input_tokens + cache_read_tokens + cache_creation_tokens`. They are additive, not a subset of `input_tokens`.

Context token semantics are for context-pressure analytics, not billing. Writers MAY emit `context_input_tokens` when the source exposes prompt/context tokens for the request, including cache-read and cache-creation tokens when those count against the context window. Writers MAY emit `context_window_tokens` when the source reports the model's positive context-window size for the request. Writers MUST NOT estimate either field from raw text or tokenizer assumptions, and MUST NOT fabricate a `context_window_tokens` value from model name alone. Consumers derive context pressure as `context_input_tokens / context_window_tokens` when both fields are present; otherwise the ratio is unavailable.

Model identification for downstream cost analysis uses `payload.model` first, falls back to `header.agent.model_default`, and is otherwise unknown. The `usage` object does not carry its own model field.

When a single source envelope fans out to multiple entries (text blocks, tool calls, thinking blocks sharing one API response), `usage` accounts for the whole envelope. Writers MUST attach it to the first derived entry whose payload supports `usage`, skip non-usage-capable derived entries, and MUST NOT repeat it on later derived entries. In v0.1.0, `usage` is valid on `agent_message`, `agent_thinking`, and `tool_call` payloads; if an envelope emits none of those entries, canonical `usage` is omitted.

Monetary cost is intentionally not a canonical trail field or event. Analyzers compute cost from token usage, model identification, and their own pricing tables, and carry pricing provenance such as currency, pricing source, and effective date in analyzer output. If a source exposes a billing estimate, writers may preserve it as opaque source data under reverse-domain or `x-<adapter>/` keys on the entry's `meta` field (§8.0.3). Latency and wall-clock telemetry are deferred to a future minor version; sources rarely expose them consistently.

#### `task_plan_update`

The agent emitted a checklist or plan snapshot. This is the canonical representation for structured planning state. Writers MUST NOT represent these snapshots as `tool_call.payload.tool:"task_plan"`.

```jsonc
{
  "type": "task_plan_update",
  "id": "...",
  "ts": "...",
  "payload": {
    "explanation": "optional note",
    "items": [
      {
        "id": "item-1",
        "content": "Write failing test",
        "status": "in_progress",
        "active_form": "Writing failing test"
      }
    ],
    "deltas": [
      {
        "kind": "status_changed",
        "item_id": "item-1",
        "from_status": "pending",
        "to_status": "in_progress"
      }
    ]
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `explanation` | no | string | source-provided explanation for this plan update, when present |
| `items` | yes | array | full current snapshot of plan items |
| `deltas` | no | array | best-effort differences from the previous `task_plan_update` in the same source session |

Each `items[]` entry has:

| Item field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | upstream item id if present; otherwise a deterministic adapter-synthesized id |
| `content` | yes | string | human-readable task text |
| `status` | yes | string | one of `pending`, `in_progress`, `completed`, `cancelled`, `blocked` |
| `active_form` | no | string | source-provided active/progressive wording |

When the upstream source does not provide item ids, or provides empty or whitespace-only strings, adapters SHOULD synthesize deterministic ids. Empty and whitespace-only item ids are treated as missing. The synthesized id is derived per source session from normalized content plus that content's duplicate occurrence position in the snapshot. With synthesized ids, status deltas are reliable when normalized content remains stable; content changes are best-effort because the source did not provide stable identity.

`deltas[]` entries are optional. When present, each has `kind` and `item_id` plus fields determined by `kind`:

| Delta kind | Required fields |
|---|---|
| `added` | `to_content`, `to_status` |
| `removed` | `from_content`, `from_status` |
| `status_changed` | `from_status`, `to_status` |
| `content_changed` | `from_content`, `to_content` |

`added` may include `to_active_form`; `removed` may include `from_active_form`. Sources that only report plan-completed notifications with no item status snapshot should preserve them as `system_event` records instead of inventing checklist state.

#### `tool_call`

The agent invoked a tool. Tool kinds use the taxonomy in [§10](#10-canonical-tool-taxonomy).

```jsonc
{
  "type": "tool_call",
  "id": "...",
  "ts": "...",
  "payload": {
    "tool": "file_read",
    "args": { "path": "package.json" }
  },
  "semantic": {
    "call_id": "toolu_01abc"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `tool` | yes | string | canonical tool kind ([§10](#10-canonical-tool-taxonomy)) |
| `args` | yes | object | tool-specific args |
| `usage` | no | object | token usage when this is the first entry derived from a source envelope; see [`payload.usage`](#agent_messagepayloadusage) |

#### `tool_result`

The result of a `tool_call`. References the call via `for_id`. Writers omit `for_id` when the source does not provide a reliable match. Readers may tolerate legacy/null values; when `for_id` is null or missing, see [§9.5](#9-5-tool-call-terminal-pairing).

```jsonc
{
  "type": "tool_result",
  "id": "...",
  "ts": "...",
  "payload": {
    "for_id": "<tool-call-id>",
    "ok": true,
    "output": "<truncated-or-full>",
    "truncated": false,
    "output_size": 12345,
    "overflow_ref": null,
    "error": null
  },
  "semantic": {
    "call_id": "toolu_01abc",
    "tool_kind": "file_read"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `for_id` | no | string | id of the matching `tool_call`; omit when unknown |
| `ok` | yes | boolean | did the call succeed |
| `output` | no | string | textual output |
| `truncated` | no | boolean | true if `output` was truncated |
| `output_size` | no | integer ≥0 | UTF-8 byte length of the original output before truncation; required when `truncated` is true |
| `overflow_ref` | no | string | reference to full output |
| `error` | no | string | error message if `ok` is false |
| `attachments` | no | array | non-MCP image / multi-part tool output by reference (e.g. a screenshot or plot tool returning an image that `output` flattens); same object shape as `user_message.payload.attachments` |
| `meta` | no | object | structured per-toolkind outputs; see below |

`attachments[]` on `tool_result` carries image or binary results from tools whose output `output` (a display string) cannot represent — typically `tool: "other"` kinds such as a screenshot or plotting tool. MCP tools instead preserve their native block structure in `meta.mcp_call.content_blocks` (below); `attachments[]` is the generic escape hatch for everything else.

#### `tool_call_aborted`

The agent attempted or began a tool invocation, but the invocation was cancelled, blocked, timed out, denied, or otherwise stopped without a normal `tool_result`. Use this instead of inventing a failed `tool_result` when the source evidence says no result was produced.

```jsonc
{
  "type": "tool_call_aborted",
  "id": "...",
  "ts": "...",
  "payload": {
    "scope": "tool_call",
    "reason": "hook_blocked",
    "for_id": "<tool-call-id>",
    "blocked_by": "PreToolUse:Bash"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `scope` | yes | enum or extension | `tool_call` when a specific call is known; `turn` when the source only proves a turn-level abort. Adapter extensions must use `x-<adapter>/<scope>`. |
| `reason` | yes | enum or extension | One of `user_interrupt`, `hook_blocked`, `timeout`, `permission_denied`, `runtime_error`, or `x-<adapter>/<reason>`. |
| `for_id` | when `scope:"tool_call"` | string | id of the matching `tool_call`; omitted for `scope:"turn"` and other non-call-specific scopes. |
| `blocked_by` | no | string | hook, policy, permission system, or runtime component that stopped the call. |

Bare unknown `scope` and `reason` values are writer-strict errors. Readers are tolerant of unknown `x-*` extension values.

##### `tool_result.payload.meta` — structured outputs

`output` is a display string. When the source tool returned structured data, writers MAY also
populate `meta`, an object keyed by the originating `tool_call.tool` (the canonical tool kind, [§10](#10-canonical-tool-taxonomy)).
Consumers that understand a kind read `meta.<toolKind>`; everyone else falls back to `output`. `meta`
is optional and additive — existing writers that emit only `output` stay valid.

Registered keys are writer-strict (unknown fields inside a registered shape are rejected). Vendors
extend a registered tool kind by adding sibling keys to its object that match the `x-<vendor>/`
pattern (e.g. `meta.mcp_call.x-acme/cache_hit`). Unregistered and future tool kinds are accepted as
opaque objects, so new kinds can be standardized in a later minor version without a schema migration.

The v0.1 registry covers three tool kinds:

`meta.mcp_call` — preserves MCP content-block structure that `output` flattens.

| Sub-field | Required | Type | Notes |
|---|---|---|---|
| `content_blocks` | no | array | MCP content blocks; each block has `type` (`text`/`image`/`resource`) plus `text`/`data`/`mime_type`/`uri` as applicable |
| `is_error` | no | boolean | MCP-protocol error flag. Distinct from envelope `payload.ok`: `is_error` is the tool's own success signal, `ok` is the trail-level call outcome |

`meta.file_read` — read range and truncation metadata.

| Sub-field | Required | Type | Notes |
|---|---|---|---|
| `range` | no | array | `[start_line, end_line]` requested |
| `total_lines` | no | integer ≥0 | total lines in the file |
| `encoding` | no | string | detected/used encoding |
| `truncated_at_line` | no | integer ≥0 \| null | line where output was cut, or null if untruncated |

`meta.shell_command` — separated streams and exit status.

| Sub-field | Required | Type | Notes |
|---|---|---|---|
| `stdout` | no | string | standard output stream |
| `stderr` | no | string | standard error stream |
| `exit_code` | no | integer \| null | process exit code; null when terminated by signal |
| `signal` | no | string \| null | terminating signal (e.g. `SIGKILL`), or null |
| `duration_ms` | no | integer ≥0 | wall-clock duration |

`meta.shell_command.exit_code` is the canonical home for shell exit status; there is no generic
top-level `exit_code` on `tool_result`, because the concept does not apply to kinds like `mcp_call`
or `web_fetch`.

Privacy: `meta` carries the same raw content as `output` (shell stdout, MCP block text), so the
redaction pipeline scrubs `meta` string leaves alongside `output` (§15).

#### `user_query`

The agent asks the user one or more structured questions and yields control until the user answers or dismisses the prompt. This is not a `tool_call`: no external tool executes.

```jsonc
{
  "type": "user_query",
  "id": "...",
  "ts": "...",
  "payload": {
    "questions": [
      {
        "id": "ship",
        "header": "Ship",
        "question": "Ship it?",
        "multi_select": false,
        "is_secret": false,
        "allow_other": true,
        "options": [
          { "label": "yes", "description": "Ship now" },
          { "label": "no" }
        ]
      }
    ]
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `questions` | yes | array | One or more structured questions. |

| Question field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Stable within this `user_query`; responses key answers by this value. |
| `question` | yes | string | Full prompt shown to the user. |
| `header` | no | string | Short label/chip. |
| `multi_select` | no | boolean | True when the user may select multiple options. Omitted means false. |
| `is_secret` | no | boolean | True when answers should be hidden and stripped by redaction. Omitted means false. |
| `allow_other` | no | boolean | True when free-form input beyond listed options is allowed. Omitted means false. |
| `options` | no | array | Option objects with required `label`, optional stable `id`, and optional `description`. |

#### `user_query_response`

The user's response to a `user_query`. `payload.for_id` links to the query entry id. A dismissed prompt emits a response with an empty `answers` object.

```jsonc
{
  "type": "user_query_response",
  "id": "...",
  "ts": "...",
  "payload": {
    "for_id": "<user-query-id>",
    "answers": {
      "ship": {
        "selected": ["yes"],
        "other": "with changelog"
      }
    }
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `for_id` | yes | string | Entry id of the `user_query`. |
| `answers` | yes | object | Keys are `questions[].id`. May be empty for dismissed/unanswered prompts. |

| Answer field | Required | Type | Notes |
|---|---|---|---|
| `selected` | yes | string[] | Selected option ids when that question's options carry ids, otherwise selected option labels. Use one value for single-select answers. |
| `other` | no | string | Free-form answer when `allow_other` was used. |

Privacy: share-time redaction MUST strip answers for questions whose `is_secret` is true, regardless of pattern matching.

#### `session_summary`

A summary entry. Used for whole-session summaries. Branch and compaction summaries use `branch_summary` and `context_compact`.

```jsonc
{
  "type": "session_summary",
  "id": "...",
  "ts": "...",
  "payload": {
    "scope": "session",
    "text": "<summary>",
    "model": "<model>"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `scope` | yes | enum | `session` |
| `text` | yes | string | the summary |
| `model` | no | string | model that produced the summary |

### 9.3 Optional event types

Part of the canonical vocabulary. Adapters need not emit them. Readers must tolerate them either way.

#### `session_metadata_update`

Post-creation update to logical session metadata. The session header carries the base value when it is known at write time; consumers that need effective session metadata start with the header value and then replay these events in file order, with the last update to a field winning. The header remains as-written, and the event is part of normal session content that contributes to the session-level `content_hash`.

```jsonc
{
  "type": "session_metadata_update",
  "id": "...",
  "ts": "...",
  "payload": {
    "field": "name",
    "value": "Implement metadata updates",
    "previous_value": "Old title",
    "reason": "ai_generated"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `field` | yes | enum or extension | One of `name`, `description`, `tags`, `agent.model_default`, `vcs.branch`, `vcs.worktree`, or an adapter extension `x-<adapter>/<key>`. |
| `value` | yes | field-specific | Replacement value. Must match the field type: string for `name`/`description`/`agent.model_default`/`vcs.branch`, string array for `tags`, and the §8.2 worktree shape for `vcs.worktree`. Extension fields may carry any JSON value. |
| `previous_value` | no | field-specific | Prior value when the adapter knows it. Same type as `value`. |
| `reason` | yes | enum | `ai_generated`, `user_set`, `runtime_inferred`, or `external`. |

Writers MUST NOT use this event for immutable identity or cryptographic fields such as `id`, `session_uid`, `content_hash`, `redacted_from`, `vcs.revision`, or `vcs.head_commit`. Working-directory changes remain `system_event.kind:"cwd_change"`.

#### `system_event`

A meaningful source timeline record that is not a user message, agent message, tool call, tool result, summary, or known lifecycle event. Use this for source status/progress/bookkeeping records that should remain visible in a timeline. Do not use it as a dumping ground for high-volume internal state or records that map cleanly to a more specific canonical event.

```jsonc
{
  "type": "system_event",
  "id": "...",
  "ts": "...",
  "payload": {
    "kind": "hook_fired",
    "text": "Hook progress: PreToolUse",
    "data": { "hook": "PreToolUse" }
  }
}
```

`kind` is required and writer-strict. It must be either one of the reserved cross-agent values below, or an adapter-namespaced extension of the form `x-<adapter>/<name>` (lowercase, kebab-case adapter, snake/kebab name). Bare unknown strings are rejected by writer-strict validation. Readers are tolerant of unknown `x-*` kinds and pass them through. `data` is curated structured metadata for rendering and search, not a replacement for `source.raw`.

`context_compact`, `user_interrupt`, `model_change`, `mode_change`, and `thinking_level_change` are first-class record types ([§9.3](#9-3-optional-event-types)). Do not duplicate them under `system_event.kind`.

##### Reserved lifecycle vocabulary

| `kind` | When to use |
| --- | --- |
| `session_start` | Explicit mid-stream session-start marker (header already covers, useful for tooling that splits on events). |
| `session_end` | Clean exit marker. |
| `turn_start` | User prompt accepted, agent begins work. |
| `turn_end` | Agent finishes a turn. |
| `subagent_start` | A spawned subagent begins. |
| `subagent_end` | A spawned subagent returns. |
| `pre_tool_use` | Tool about to fire (hook intercept point). |
| `post_tool_use` | Tool finished. |
| `hook_fired` | Generic adapter-emitted hook trace. |
| `permission_request` | Agent asked the user for tool approval. |
| `permission_decision` | User allowed/denied a specific tool invocation. |
| `permission_mode_change` | Deprecated compatibility value for v0.1.0 trails. New writers MUST emit `mode_change` with `scope:"permission"` instead. |
| `cwd_change` | Working directory shifted. |
| `env_snapshot` | Shell/env state capture. |

##### Reserved source-signal vocabulary

| `kind` | When to use | Suggested `data` shape |
| --- | --- | --- |
| `task_started` | Source emits a structured task/step begin marker. | `{ task_id, title? }` |
| `task_completed` | Pair to `task_started`. May be synthesized at EOF for unclosed tasks (set `source.synthesized: true`). | `{ task_id, summary?, status? }` |
| `plan_completed` | Source emits a plan or todo completion marker without a full plan snapshot. | `{ plan_id, preview? }` |
| `turn_aborted` | Model or system stopped a turn for non-user reasons (length limit, refusal, error). Distinct from `user_interrupt`. | `{ reason }` |
| `tool_decision` | Source recorded a user approve/reject decision on a tool call. | `{ decision, tool_call_id }` |
| `hook_progress` | Catch-all for source-emitted progress/hook/queue records that do not map to a more specific reserved lifecycle kind. Adapters SHOULD prefer `session_start` / `session_end` / `turn_end` / `pre_tool_use` / `post_tool_use` / `subagent_end` / `hook_fired` when the source signal is unambiguous, and fall back to `hook_progress` only for unrecognised progress streams. | `{ hook_event?, hook_name?, ... }` |
| `queue_operation` | Source recorded an enqueue or dequeue operation. | Free-form. |
| `heartbeat` | Periodic liveness ping during streaming capture (§8.4). Optional. Non-normative; readers may treat as informational. | `{ interval_ms? }` |

##### Reserved diagnostic vocabulary

Cross-agent diagnostic signals. Adapters MAY emit these to surface non-fatal errors, warnings, deprecations, routing decisions, and hook failures in the timeline. Out of scope: per-tool errors (those stay on `tool_result.error` + `tool_result.ok=false`).

| `kind` | When to use | Suggested `data` shape |
| --- | --- | --- |
| `agent_error` | Agent-side error not tied to a specific tool call. | `{ severity?, code?, category?, blocking?, recovered?, source?, details? }` |
| `agent_warning` | Non-fatal agent-side warning. | `{ severity?, code?, category?, blocking?, recovered?, source?, details? }` |
| `api_error` | Upstream LLM/API failure surfaced to the user. | `{ severity?, code?, category?, source?, details? }` |
| `stream_error` | Streaming response interrupted or failed. | `{ severity?, code?, recovered?, details? }` |
| `deprecation_notice` | Source announced a feature or capability deprecation. | `{ feature?, replacement?, details? }` |
| `guardian_alert` | Safety rail, guardian system, or content moderation triggered. | `{ severity?, policy?, action?, details? }` |
| `model_rerouted` | Model fallback or capability re-routing decision. | `{ from?, to?, reason?, details? }` |
| `hook_failed` | Runtime hook execution failed, blocking or non-blocking. | `{ severity?, blocking?, hook_name?, code?, details? }` |

**Severity vocabulary (informative).** When adapters include `data.severity`, recommended values are `info`, `warning`, `error`, `critical`. Not schema-enforced; readers SHOULD treat unknown severities as opaque.

**Source vocabulary (informative).** When `data.source` is present, common values include `anthropic`, `openai`, `hook`, `guardian`, `runtime`. Free-form at the schema layer.

##### Recommended `payload.data` shapes (permission kinds)

`data` stays freeform at the schema layer. Adapters SHOULD use the shapes below so cross-agent consumers can render permission flow without per-adapter switches. Promote to schema-enforced once 2+ adapters converge.

| `kind` | Recommended `data` |
| --- | --- |
| `permission_request` | `{ tool_call_id?: string, capability?: string, prompt?: string }` |
| `permission_decision` | `{ decision: "allow" \| "deny", tool_call_id?: string, capability?: string }` |
| `permission_mode_change` | Deprecated v0.1.0 compatibility shape `{ to: string, from?: string }`. New writers MUST use `mode_change{scope:"permission"}`. |

##### Extension policy and promotion

- Reserved values above are the only bare strings allowed by writer-strict validation.
- Anything else must use `x-<adapter>/<name>` form, e.g. `x-claudecode/notification`.
- Readers are tolerant of unknown `x-*` kinds — they pass through with no diagnostic.
- Bare unknown strings (no `x-` prefix, not in the reserved set) are rejected by writer-strict validation.
- If an `x-*` kind proves cross-agent, promote it to the reserved enum in a minor format version bump. Document emitted kinds per adapter in `docs/parser-source-matrix.md`.

#### `capability_change`

A change in the set of capabilities available to the agent at a point in the session. Use this for tool, skill, plugin, MCP server, and MCP tool registry snapshots/deltas. This records availability changes, not tool invocations; calls still use `tool_call` / `tool_result`.

```jsonc
{
  "type": "capability_change",
  "id": "...",
  "ts": "...",
  "payload": {
    "scope": "tool",
    "reason": "registered",
    "added": [{ "name": "Search", "metadata": { "namespace": "example" } }]
  }
}
```

| Payload field | Required | Type | Notes |
| --- | --- | --- | --- |
| `scope` | yes | string enum | `tool` \| `skill` \| `mcp_server` \| `mcp_tool` \| `plugin` |
| `reason` | yes | string enum | `registered` \| `deregistered` \| `connected` \| `disconnected` \| `loaded` \| `unloaded` \| `error` \| `instructions_updated` |
| `added` | no | array | Non-empty array of `{ name, metadata? }`. |
| `removed` | no | array | Non-empty array of `{ name }`. |
| `changed` | no | array | Non-empty array of `{ name, field, from?, to? }`. |
| `snapshot` | no | array | Non-empty array of `{ name, metadata? }`; replaces accumulated state for this `scope` at this point. |

Writer-strict validation requires at least one of `added`, `removed`, `changed`, or `snapshot`.

Out of scope: full tool input/output schemas; they are static registry data and can be large or sensitive. Writers should keep only compact identifying metadata in `metadata`.

#### `command_invoke`

A named capability invoked with optional arguments: a user-typed slash command, a built-in CLI affordance, a skill activation, a user-defined prompt template, or a plugin command. These surfaces share the "named capability invoked" semantic but vary along two orthogonal axes — `kind` records *what* was invoked, `via` records *how* it reached the agent. Without this event they leak as `user_message.text="/foo"`, `tool_call.tool=other` with `args.name="Skill"`, or get dropped.

```jsonc
{
  "type": "command_invoke",
  "id": "...",
  "ts": "...",
  "payload": {
    "name": "/code-review",
    "kind": "custom_prompt",
    "via": "user_typed",
    "args": { "target": "HEAD" },
    "expansion_text": "Review the diff against main.",
    "result_action": "expand"
  }
}
```

| Payload field | Required | Type | Notes |
| --- | --- | --- | --- |
| `name` | yes | string | User-visible identifier. Leading slash for slash/builtin/custom_prompt (`/clear`); bare name for skills (`webapp-testing`). |
| `kind` | yes | string enum | `slash` \| `builtin` \| `skill` \| `custom_prompt` \| `plugin`. What kind of capability was invoked. |
| `via` | yes | string enum | `user_typed` \| `auto_trigger` \| `agent_invoked`. How the invocation reached the agent. |
| `args` | no | object | Free-form invocation arguments. |
| `expansion_text` | no | string | Post-expansion prompt text the agent saw (for prompt-template commands). |
| `result_action` | no | string \| null | What the runtime did with it. Reserved value, `x-<adapter>/<name>` extension, or null. |

`kind` discriminates the capability: skill activation → `skill`, built-in command → `builtin`, user-defined prompt template → `custom_prompt`, generic slash command → `slash`, extension/plugin command → `plugin`.

`via=auto_trigger` covers description-matched skill activation with no user action. Adapters MAY synthesize it when they observe a skill load without a corresponding `Skill` tool call; set `source.synthesized: true` in that case.

`result_action` helps analyzers correlate to subsequent `context_compact` or session resets without inferring from content. Reserved values:

| `result_action` | When to use |
| --- | --- |
| `compact` | Invocation triggered a context compaction (`/compact`). |
| `clear` | Invocation reset the session (`/clear`). |
| `expand` | Prompt-template command expanded into agent input. |
| `load_skill` | A skill was loaded into context. |
| `noop` | Runtime accepted the command with no observable state change. |

Beyond these, `result_action` accepts an adapter-namespaced extension of the form `x-<adapter>/<name>` (lowercase, kebab-case adapter, snake/kebab name), or `null`. Bare unknown strings are rejected by writer-strict validation; readers are tolerant of unknown `x-*` values.

Out of scope: skill *contents* (static config, not session history); MCP server tools (covered by `tool_call.tool=mcp_call`); permission gates (covered by `system_event.kind=permission_request/decision`).

#### `agent_thinking`

Chain-of-thought or reasoning block.

```jsonc
{
  "type": "agent_thinking",
  "id": "...",
  "ts": "...",
  "payload": { "text": "...", "model": "...", "level": "medium" }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `text` | yes | string | reasoning content exposed by the source |
| `model` | no | string | model that produced this thinking block |
| `level` | no | enum | `low` \| `medium` \| `high` \| `xhigh` |
| `usage` | no | object | token usage when this is the first entry derived from a source envelope; see [`payload.usage`](#agent_messagepayloadusage) |

#### `user_interrupt`

User interrupted an in-progress agent response.

```jsonc
{
  "type": "user_interrupt",
  "id": "...",
  "ts": "...",
  "payload": { "reason": "<optional>" }
}
```

#### `context_compact`

Session was compacted to free context window.

```jsonc
{
  "type": "context_compact",
  "id": "...",
  "ts": "...",
  "payload": {
    "summary": "<text>",
    "trigger": "auto",
    "tokens_before": 12000,
    "tokens_after": 4000,
    "replaced_message_ids": ["<entry-id>", "<entry-id>"]
  }
}
```

`trigger`: `manual` | `auto`.

`replaced_message_ids`: optional Agent Trail entry IDs folded or replaced by this
compaction summary, in source order. These IDs are provenance-only; readers MUST
validate their ID shape but MUST NOT require them to resolve to entries present in
the same trail file.

#### `branch_point`

Marks where a branch was made.

```jsonc
{
  "type": "branch_point",
  "id": "...",
  "ts": "...",
  "payload": {
    "from_id": "<entry-the-branch-departed-from>",
    "reason": "<optional>"
  }
}
```

#### `branch_summary`

A summary of an abandoned branch, attached to the active branch.

```jsonc
{
  "type": "branch_summary",
  "id": "...",
  "ts": "...",
  "payload": {
    "abandoned_branch_id": "<root-of-abandoned-branch>",
    "summary": "<text>",
    "model": "..."
  }
}
```

#### `model_change`

Active model changed mid-session.

```jsonc
{
  "type": "model_change",
  "id": "...",
  "ts": "...",
  "payload": {
    "from_model": "<id>",
    "to_model": "<id>",
    "trigger": "runtime_inferred",
    "turn_id": "<source-turn-id>"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `from_model` | no | string | previous model id; omit when the source did not track the prior model |
| `to_model` | yes | string | new active model id |
| `from_provider` | no | string | previous model provider when known |
| `to_provider` | no | string | new model provider when known |
| `reason` | no | string | source-provided or adapter-inferred reason |
| `trigger` | no | enum or `x-*` | `initial`, `user_set`, `agent_set`, `runtime_inferred`, `auto_reroute`, `external`, or adapter extension |
| `turn_id` | no | string | source turn id associated with the observation |

#### `mode_change`

Active runtime mode changed or was first observed. Use this for common mode axes such as collaboration mode (`plan`, `auto`), permission mode, execution/sandbox mode, or UI mode. Per-tool approval still uses `system_event.kind:"permission_request"` / `"permission_decision"`.

```jsonc
{
  "type": "mode_change",
  "id": "...",
  "ts": "...",
  "payload": {
    "scope": "permission",
    "from_mode": "default",
    "to_mode": "acceptEdits",
    "trigger": "runtime_inferred",
    "turn_id": "<source-turn-id>"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `scope` | yes | enum or `x-*` | `collaboration`, `permission`, `execution`, `ui`, or adapter extension |
| `from_mode` | no | string | previous mode token |
| `to_mode` | yes | string | new or initially observed mode token |
| `reason` | no | string | source-provided or adapter-inferred reason |
| `trigger` | no | enum or `x-*` | `initial`, `user_set`, `agent_set`, `runtime_inferred`, `auto_reroute`, `external`, or adapter extension |
| `turn_id` | no | string | source turn id associated with the observation |
| `data` | no | object | curated adapter metadata for this mode axis |

#### `thinking_level_change`

Active reasoning/thinking level changed or was first observed. This records the selected thinking budget/effort level, not the model's private chain of thought. Reasoning text remains `agent_thinking`.

```jsonc
{
  "type": "thinking_level_change",
  "id": "...",
  "ts": "...",
  "payload": {
    "from_level": "medium",
    "to_level": "high",
    "trigger": "runtime_inferred",
    "turn_id": "<source-turn-id>"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `from_level` | no | string | previous thinking-level token |
| `to_level` | yes | string | new or initially observed thinking-level token |
| `reason` | no | string | source-provided or adapter-inferred reason |
| `trigger` | no | enum or `x-*` | `initial`, `user_set`, `agent_set`, `runtime_inferred`, `auto_reroute`, `external`, or adapter extension |
| `turn_id` | no | string | source turn id associated with the observation |
| `data` | no | object | curated adapter metadata for this level axis |

#### `session_terminated`

Marks an incomplete session ending. Adapters may emit this synthetically at EOF when the source file ends with unmatched `tool_call` events (process killed mid-execution, file truncated, etc.).

```jsonc
{
  "type": "session_terminated",
  "id": "...",
  "ts": "...",
  "payload": {
    "reason": "eof_with_open_tool_calls",
    "open_call_ids": ["<id-1>", "<id-2>"]
  },
  "source": { "synthesized": true }
}
```

`reason`: `eof_with_open_tool_calls` | `process_terminated` | `truncated` | `user_abort`.

Synthesized instances must set `source.synthesized: true`.

#### `session_end`

Clean terminal marker. Distinct from `session_terminated` (abnormal). Optional; many writers won't emit it. When present at EOF, signals a normal conclusion of the session and suppresses the "unmatched tool calls at EOF" warning of §16.4.

```jsonc
{
  "type": "session_end",
  "id": "...",
  "ts": "...",
  "payload": {
    "reason": "complete",
    "final_message_id": "<entry-id>"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `reason` | yes | enum | `complete` \| `user_quit` \| `agent_idle` |
| `final_message_id` | no | string | optional reference to the last meaningful event |

### 9.4 Semantic linking

The `semantic` block on an event provides linking metadata when explicit `id` / `parent_id` / `for_id` references are unreliable (source has missing or null IDs).

| Field | Type | Purpose |
|---|---|---|
| `semantic.group_id` | string | Groups events that belong to one logical unit. |
| `semantic.call_id` | string | Source format's native ID for a tool call. Used as fallback pairing key. |
| `semantic.tool_kind` | string | Canonical tool kind. Useful on `tool_result` events that don't carry it directly. |

Writers should populate `semantic.call_id` on tool_call/tool_result pairs when the source has reliable native call IDs that are not Agent Trail entry IDs.

### 9.5 Tool call terminal pairing

`tool_result.payload.for_id` and `tool_call_aborted.payload.for_id` should reference the matching `tool_call`. Writers MUST populate `tool_result.payload.for_id` or `semantic.call_id` when the source records concurrent (overlapping) tool calls, and SHOULD populate one of them for every result. A `tool_call_aborted` only closes a call when `payload.scope == "tool_call"` and `payload.for_id` resolves to a `tool_call`; turn-level aborts do not close any specific call.

When `tool_result.payload.for_id` is null, missing, or refers to a non-existent event, readers use these fallback rules in order:

1. **Semantic match.** If both events have `semantic.call_id` and they're equal, pair them.
2. **Sequential match.** Pair the `tool_result` with the most recent prior unmatched `tool_call` in the same branch scope. Sequential fallback considers only calls in the same nearest `parent_id` ancestry as the result, so an inline subagent subtree cannot capture a parent timeline result and a parent timeline result cannot capture a child subtree call. Linear sessions without `parent_id` are unchanged.
3. **Heuristic match.** Readers may use further heuristics (timestamp proximity, payload shape) but must flag the pairing as uncertain in rendered output.

Writers should avoid relying on fallbacks. Populate `for_id` when reliable; use `semantic.call_id` when the source's native ID doesn't map cleanly to event `id`. Do not use semantic or sequential fallback pairing for `tool_call_aborted`; if a source cannot identify the call, emit `scope:"turn"` without `for_id`.

Validators apply the deterministic pairing rules when computing the "unmatched `tool_call` at EOF" warning (§16.4): explicit `for_id` references from `tool_result` and call-scoped `tool_call_aborted` first, then fallback rules 1 and 2 above for `tool_result` only (semantic match, branch-scoped sequential match). The heuristic rule (3) is reader-only — it produces uncertain pairings that readers must flag in rendered output, so validators do not apply it. A `tool_call` is considered matched when one of these deterministic methods pairs it with a `tool_result` or call-scoped `tool_call_aborted`.

### 9.6 Unknown event types

Readers must tolerate unknown types:

- Preserve them when round-tripping.
- Render with a generic fallback.
- Do not abort parsing.

Writers MUST NOT invent new top-level event types in v0.1 writer-strict output. Use the `other` tool kind ([§10](#10-canonical-tool-taxonomy)) or `source.raw` ([§9.1](#9-1-base-shape), [§14.1](#14-1-source-raw-elision-and-redaction)) for adapter-specific data, or `meta` ([§8.0.3](#8-0-3-the-meta-extension-convention) / [§11](#11-vendor-extensions)) for vendor extensions. Reader-tolerant parsing may preserve unknown future event types at runtime; this tolerance is not part of the writer schema.

### 9.7 Source envelope referencing

When a single source envelope produces multiple entries — for example, an assistant message envelope whose `content` array is split across one `agent_message`, one `agent_thinking`, and one `tool_call` entry — writers should not inline the full envelope on every derived entry. Use *inline-first / ref-subsequent* dedup:

- The **first** entry derived from a given source envelope sets `source.raw.envelope` (and `source.raw.block`, `source.raw.block_index` if applicable).
- **Subsequent** entries derived from the same envelope set `source.raw.envelope_ref` to the first entry's `id`. They omit `source.raw.envelope` and keep `block` / `block_index`.

`source.raw.envelope_ref` is an optional string. Writers must ensure it references the `id` of an entry that appears **earlier** in the same file — the same envelope, inlined once. Forward references and dangling references are reader errors (`source_raw_envelope_ref_unresolved`, §16.4). The first-inline-then-ref shape is streaming-write friendly: readers resolve refs in a single pass without backtracking.

This mechanism is additive over v0.1.0. Readers that do not understand `envelope_ref` will see it as an unknown raw-source field and ignore it; the entry's other fields (`type`, `payload`, `semantic`) remain fully self-describing.

---

## 10. Canonical tool taxonomy

The `tool_call.payload.tool` field uses these values. Each defines the expected shape of `args`.

| Name | Args |
|---|---|
| `file_read` | `{ path, range? }` |
| `file_write` | `{ path, content }` |
| `file_edit` | `{ path, diff }` (unified diff) or `{ path, old, new, replace_all? }` |
| `file_patch` | `{ files: [{ path, diff }], atomic? }` |
| `file_list` | `{ path, recursive?, glob? }` |
| `file_search` | `{ query, path?, glob? }` |
| `shell_command` | `{ command, cwd?, timeout? }` |
| `shell_output` | `{ command_id? }` |
| `shell_input` | `{ input, session_id?, command_id? }` |
| `mcp_call` | `{ server, tool, args, headers? }` |
| `web_fetch` | `{ url, method?, headers? }` |
| `web_search` | `{ query }` |
| `tool_search` | `{ query, limit? }` |
| `notebook_edit` | `{ path, cell_id?, diff?, content? }` |
| `subagent_invoke` | `{ task, agent_type?, session_id? }` |
| `other` | `{ name, args }` |

Checklist and plan snapshots use `task_plan_update` ([§9.2](#9-2-mandatory-event-types)) rather than `tool_call`.

### 10.1 `file_edit`

`file_edit` has two exclusive argument forms:

- `{ path, diff }` where `diff` is a unified diff.
- `{ path, old, new, replace_all? }` for sources that record only string replacement with no line context.

Writers MUST prefer the diff form when a real unified diff is derivable from source data. Writers MUST NOT fabricate hunk headers to fake the diff form.

The `diff` form uses a unified diff:

```diff
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,4 +1,4 @@
 unchanged
-removed
+added
 unchanged
```

Writers with native before/after content must convert to a diff before emitting. Writers that synthesize the edit from indirect source data set `source.synthesized: true`.

### 10.2 `file_patch`

Use `file_patch` when one source tool call represents a patch touching one or more files, and
single-file `file_edit` would either lose the call's multi-file grouping or force consumers to
reconstruct it from synthesized sibling calls. Each `files[]` entry carries the affected `path` and a
per-file unified diff. Writers that split source-native patch text into per-file hunks should add
`---` and `+++` file headers when the source omits them, so generic consumers can render each file
without parsing the source-native patch envelope. For renames, `path` is the destination path and the
diff headers carry both source and destination paths. Set `atomic: true` when the source represented
the patch as one operation.

### 10.3 `file_list`

Use `file_list` when the agent inspected a directory or file tree. The result's display listing
lives in the matching `tool_result.payload.output`. Do not map directory listing to
`shell_command` unless the source only records a literal shell command.

### 10.4 `shell_command`

Full command in `command`; output in the corresponding `tool_result.payload.output`. Redactors should scrub env vars, `Authorization` headers in piped curls, etc.

### 10.5 `mcp_call`

- `server` — MCP server identifier (e.g., `github`, `linear`).
- `tool` — tool name within that server.
- `headers` — should be redacted before writing: `Authorization`, `X-API-Key`, `Cookie`, `Bearer ...`.

### 10.6 `subagent_invoke`

Indicates a child conversation was spawned. Two cases:

- **Inline subtree:** when the source stores child events inline in the same session, child events use this event's `id` as their root `parent_id`.
- **External child session:** when the source stores the child as a separate transcript, set `args.session_id` to the child session header `id`. The child may appear as a sibling group in the same session bundle or as an external trail. Do not use a content hash or source runtime id in `args.session_id`.

When the external child appears in the same file, the child header SHOULD set `fork_from.session_id` to the parent session header `id` and `fork_from.entry_id` to the parent `subagent_invoke` event `id`. `fork_from.content_hash` is optional best-effort and refers to the parent session-level content hash.

### 10.7 The `other` escape hatch

For tools not covered above, use `tool: "other"` with `args: { name, args }`. Readers render generically. These don't participate in cross-agent comparison.

---

## 11. Vendor extensions

Implementations and vendors can add custom data via the `meta` field on the trail envelope, session header, or any event entry. Use reverse-domain notation for keys to avoid collisions:

```jsonc
"meta": {
  "com.cursor.workspace_id": "ws-abc123",
  "dev.example.custom_flag": true,
  "io.anthropic.usage": { "input_tokens": 1234, "output_tokens": 567 }
}
```

Readers may preserve, ignore, or render `meta` fields. They must not abort on unknown keys.

`entry.meta.redaction_count` is a standard optional non-negative integer convention for redacted artifacts. It counts how many redactor mutations were applied to that entry; see §15.

The `meta` field is for fields outside the canonical vocabulary. For verbatim source-event preservation, use `source.raw` ([§14.1](#14-1-source-raw-elision-and-redaction)) instead. See [§8.0.3](#8-0-3-the-meta-extension-convention) for the full convention.

---

## 12. Tree and branching

### 12.1 When to emit `parent_id`

`parent_id` represents tree topology, not ordinary linear sequencing. Linear sessions use file order. Tool call/result pairing uses `tool_result.payload.for_id` and `semantic.call_id`, not `parent_id`.

Writers SHOULD emit `parent_id` only when source data contains branch, fork, or inline child-event topology that can be mapped to Agent Trail event ids.

`parent_id` is intra-group topology only. It MUST NOT span session groups. When source data stores a spawned or forked transcript as a separate session, use a child session with `header.fork_from` instead of cross-group `parent_id`.

Reader display policies for linear and tree-aware renderers are implementation semantics, not wire-format rules.

### 12.2 Acyclicity

The `parent_id` graph must be acyclic. The header isn't part of the graph; nothing references it via `parent_id`.

---

## 13. Canonical agent registry

Lowercase, hyphenated:

`claude-code`, `pi`, `openclaw`, `codex-cli`, `cursor`, `opencode`, `aider`, `amp`, `cline`, `crush`, `kimi-code`, `qwen-code`, `factory`, `vibe`, `copilot-cli`, `copilot-chat`, `chatgpt`, `clawdbot`.

The registry reserves canonical names. It does not imply adapter support.

New agents may be added by amending this spec. Until registered, adapters may use a custom reverse-domain name prefixed `x-` (e.g., `x-com-example-myagent`) to reduce collisions.

---

## 14. Truncation, overflow, and raw source size

Writers MAY truncate large `tool_result` outputs to keep trails tractable. The wire format records truncation with three fields on `tool_result.payload`:

| Field | Type | Notes |
|---|---|---|
| `truncated` | boolean | `true` when `output` was shortened from its original length |
| `output_size` | integer ≥0 | UTF-8 byte length of the original output before truncation; required when `truncated` is true |
| `overflow_ref` | string | optional content-addressed reference to the full output (e.g., `sha256:<hex>`); colocated blob storage is implementation-defined |

Specific inline-size thresholds, the truncation algorithm (e.g., head-only, head-and-tail, line-aligned), and the choice of overflow storage are writer policy and belong in writer documentation, not the format.

Tool call arguments use the same top-level marker on `tool_call.payload`:

| Field | Type | Notes |
|---|---|---|
| `truncated` | boolean | `true` when `args` was shortened from its original object |
| `args_size` | integer ≥0 | UTF-8 byte length of the JCS-serialized original `args` object before truncation; required when `truncated` is true |
| `overflow_ref` | string | optional content-addressed reference to the full args object |

The marker applies to the `args` object as a whole. Individual arg strings keep their declared per-toolkind shape, just shortened. Specific thresholds and algorithms remain writer policy.

`source.raw` is optional. Writers should omit or summarize very large or sensitive raw source objects when they would make trail files unwieldy or unsafe. Share tools must inspect `source.raw` during redaction before producing a shared artifact.

### 14.1 `source.raw` elision and redaction

Writers MAY elide all or part of a `source.raw` value when it is unwieldy or unsafe to inline. Elision uses a single wire-format marker, in place of either the entire `source.raw` or any nested string leaf:

```jsonc
{ "elided": true, "size_bytes": 41208 }
```

| Field | Type | Notes |
|---|---|---|
| `elided` | boolean `true` | sentinel; readers detect elided regions by this field |
| `size_bytes` | integer | UTF-8 byte length of the elided original (informational; readers may use it for display or budgeting) |

Two placements are valid:

- **Whole-value elide:** `source.raw` itself is the marker. The original envelope is fully omitted; only its byte size is recorded.
- **Leaf elide:** any nested string is replaced with the marker. The envelope's structural skeleton (ids, parent refs, role, timestamps, block kinds) stays intact; only the bulky string body is removed.

Specific size thresholds, the algorithm a writer uses to choose which leaves to elide, and whether elision is gated by a hard cap are implementation policy — they belong in writer documentation, not the format. Validators MAY warn on entries whose `source.raw` exceeds an implementation-chosen size budget, but the wire format itself imposes no fixed limit.

When elision happens at the first emission of a source envelope (§9.7), subsequent `envelope_ref` entries still resolve — the ref points at the elided entry's `id`, not at its inlined envelope.

Adapters MUST redact known secret patterns in `source.raw` before writing — emission-time redaction is a writer responsibility, not a share-time concern. Validators emit `source_raw_unredacted_secret` (warning) when a string leaf in `source.raw` matches a known credential pattern (Authorization headers, Bearer tokens, JWT, vendor API keys, PEM private key blocks, ENV-style assignments). Share-time redaction (§15) layers additional normalization on top — paths, PII — and produces a separate artifact.

---

## 15. Redaction

The raw file format does not mandate redaction. Sharing tools produce a separate redacted artifact before upload. Raw and redacted artifacts have different `content_hash` values.

Writers and share tools should redact known secret patterns before producing shared artifacts, including string leaves inside structured metadata such as `tool_result.payload.meta`.

A complete redaction protocol is out of scope for the file format; it belongs to share tooling. Redacted artifacts may record `redacted_from.content_hash` to link back to the raw artifact without exposing local paths or raw local IDs.

Share-time redactors SHOULD populate `entry.meta.redaction_count` on each changed event entry. The count is a non-negative integer equal to the number of redactor mutations applied to that entry. Existing numeric `redaction_count` values are additive when a redacted trail is redacted again; unchanged entries keep their existing value.

Specific secret patterns, path normalization, image handling, token-usage policy, and upload workflow are implementation semantics.

---

## 16. Validation

Validation is layered because JSON Schema validates one line at a time, while several Agent Trail rules require whole-file context.

### 16.1 Writer schema

`schema.json` is the writer-strict schema for v0.1.0. It validates a single JSON object line and requires header and envelope records to use `schema_version: "0.1.0"`. It rejects unknown top-level event types. Writers use this schema for emitted envelope, header, and event lines.

`schema.json` is the canonical format contract through v1.0. Generated types, validators, and packages must derive from it rather than maintaining a separate manual contract.

### 16.2 Reader tolerance

Readers may accept compatible future v0.x files best-effort: skip unknown event types, ignore unknown payload fields, preserve unknown records when round-tripping, and warn instead of aborting where possible. Reader tolerance is runtime behavior, not the writer-strict schema contract.

### 16.3 Validation diagnostics

Validators should report normalized diagnostics with `line`, `path` (JSON Pointer), `severity`, `code`, and `message`. Implementations may include extra fields, but these five fields are the portable diagnostic surface.

### 16.4 File graph checks

A v0.1.0-compliant trail file must also pass whole-file checks:

1. The first line is either a trail envelope (`type: "trail"`, §8.0) or a session header (`type: "session"`, `schema_version: "0.1.0"`). When the envelope is present, the session header MUST occupy line 2.
2. Subsequent lines match an event schema (`type`, `id`, `ts`, `payload`).
3. All `id` values are unique within the file.
4. Every non-null `parent_id` references an `id` in the same file.
5. The `parent_id` graph is acyclic.
6. Writer timestamps are valid UTC `Z` ISO-8601 values with millisecond precision. Readers may tolerate broader ISO-8601 timestamps.
7. All string values are well-formed: no unpaired high or low surrogate code units. Violations are `ill_formed_string` diagnostics at the offending JSON Pointer. Strict validation reports an error; reader-tolerant validation reports a warning and does not repair the value.

If `content_hash` is present:

8. The value is 64 hex characters (SHA-256).
9. Strict validators recompute and verify per §7.3. On mismatch, strict validation fails. Reader-tolerant parsers may warn but must not abort.

Warnings (non-fatal):

- Each `tool_call.id` should be referenced by exactly one `tool_result.payload.for_id` (or paired via §9.5).
- Inline `subagent_invoke` events should have descendants in the same group, or external child invocations should set `args.session_id` to the child header `id` when known.
- When an in-file child session is present, the parent `subagent_invoke.args.session_id` and child `header.fork_from.{session_id,entry_id}` should agree. Mismatches are warnings, not errors, so partial bundles and external-only references remain readable.
- `branch_summary.payload.abandoned_branch_id` should reference a real branch root.
- Writers should emit `session_terminated` if any `tool_call` remains unmatched at EOF. The warning code is `unmatched_tool_call_at_eof`. Suppression:
  - A `session_end` event anywhere in the file suppresses this warning for every unmatched `tool_call` (clean conclusion, §9.3).
  - A `session_terminated` event whose `payload.open_call_ids` lists a given `tool_call.id` suppresses the warning for that id only (explicit acknowledgement). A `session_terminated` event without `open_call_ids` does not suppress the warning.
- A `tool_result` paired by sequential fallback when two or more unmatched prior same-branch `tool_call` candidates existed emits `ambiguous_sequential_pairing` at `/payload`.
- A `user_query` question with duplicate option labels among options that do not carry stable option ids emits `duplicate_option_labels` at the repeated option's `/payload/questions/<index>/options/<index>/label`.
- `session_end.payload.final_message_id`, when present, should reference an `id` that appears in the same file (the session header or a prior event). A dangling reference is a warning with code `unknown_final_message_id` at `/payload/final_message_id`.
- Validators MAY report implementation-defined size budgets for `source.raw`; specific numbers are writer policy (§14.1).
- `source.raw` should not contain unredacted credentials. A string leaf matching a known credential pattern emits `source_raw_unredacted_secret` (warning) at the matching JSON pointer.
- `source.raw.envelope_ref`, when set, must reference the `id` of an earlier entry in the same file (§9.7). Dangling or forward references are errors with code `source_raw_envelope_ref_unresolved` at `/source/raw/envelope_ref`.
- Trail envelope position and uniqueness (§8.0):
  - `envelope_not_at_line_1` (error): a `type:"trail"` record appears on a line other than line 1.
  - `multiple_envelopes` (error): more than one envelope appears in the file.
  - `missing_header_after_envelope` (error): an envelope at line 1 is not followed by a session header on line 2.
  - `envelope_sessions_manifest_drift` (warning): the envelope's `sessions` manifest length disagrees with the number of session groups, or a manifest entry disagrees with the matching session header's `id` or `agent.name`.

Streaming rules (§8.4) are evaluated against the *current* header `stream.state` at validation time — the validator reads the present value, not a history of transitions. Crash-recovery writers MUST finalize (`stream.state` to `"closed"` or remove `stream`) before appending terminal events; once the stream is no longer marked live, the rules below stop applying.

10. If the current `header.stream.state == "open"`:
   - **10a.** `content_hash` should be absent or `"<pending>"`. A populated hex hash is a warning, since the canonical bytes are still in flux.
   - **10b.** Terminal events (`session_end`, `session_terminated`) should not appear. A terminal event in a file whose current `header.stream.state == "open"` is a warning — the writer claims the stream is still open but has already emitted a terminal event. Finalize the header (set `stream.state` to `"closed"` or remove `stream`) before appending terminal events.
11. If the current `header.stream.state == "closed"` or `stream` is absent, finalized artifacts should populate `content_hash`. Readers may warn but must not abort when it is missing on otherwise complete files. Trail files produced by stream-unaware writers, or files appended across crashes and recoveries, may contain both `session_end` and `session_terminated` legitimately; rule 10b does not apply once the stream is no longer marked live.

---

## 17. Formal schema

The normative writer-strict JSON Schema lives in `schema.json` and is published at `https://agent-trail.dev/schema/v0.1.0.json`.

This spec intentionally does not duplicate the full schema inline. Implementations should validate each JSONL line against `schema.json`, then run the whole-file checks in §16.4. Reader-tolerant parsing, including unknown future event preservation, is separate from writer-strict schema validation.

---

## 18. Examples

### 18.1 Session with tool calls and semantic pairing

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000002","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"x-com-example-agent"}}
{"type":"user_message","id":"01HEVTB0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Read package.json"}}
{"type":"tool_call","id":"01HEVTB0000000000000000002","ts":"2026-05-17T14:00:06.000Z","payload":{"tool":"file_read","args":{"path":"package.json"}},"semantic":{"call_id":"toolu_01abc"}}
{"type":"tool_result","id":"01HEVTB0000000000000000003","ts":"2026-05-17T14:00:06.000Z","payload":{"for_id":"01HEVTB0000000000000000002","ok":true,"output":"{\"name\":\"trail\"}"},"semantic":{"call_id":"toolu_01abc","tool_kind":"file_read"}}
{"type":"agent_message","id":"01HEVTB0000000000000000004","ts":"2026-05-17T14:00:08.000Z","payload":{"text":"Your package is called trail."}}
```

### 18.2 Tool result with missing for_id (fallback pairing)

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS000000000000000002B","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"x-com-example-agent"}}
{"type":"user_message","id":"01HEVTX0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Read package.json"}}
{"type":"tool_call","id":"01HEVTX0000000000000000002","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"file_read","args":{"path":"package.json"}},"semantic":{"call_id":"toolu_xyz"}}
{"type":"tool_result","id":"01HEVTX0000000000000000003","ts":"2026-05-17T14:00:02.000Z","payload":{"ok":true,"output":"{\"name\":\"trail\"}"},"semantic":{"call_id":"toolu_xyz"}}
```

The reader pairs `01HEVTX0000000000000000003` to `01HEVTX0000000000000000002` via `semantic.call_id` (rule §9.5 step 1).

### 18.3 Tree with abandoned branch

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000003","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"x-com-example-tree"}}
{"type":"user_message","id":"01HEVTC0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Try approach A"}}
{"type":"agent_message","id":"01HEVTC0000000000000000002","parent_id":"01HEVTC0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Approach A: ..."}}
{"type":"user_message","id":"01HEVTC0000000000000000003","parent_id":"01HEVTC0000000000000000001","ts":"2026-05-17T14:01:00.000Z","payload":{"text":"Actually, try approach B"}}
{"type":"branch_summary","id":"01HEVTC0000000000000000004","parent_id":"01HEVTC0000000000000000003","ts":"2026-05-17T14:01:01.000Z","payload":{"abandoned_branch_id":"01HEVTC0000000000000000002","summary":"Approach A explored but didn't work because of X"}}
{"type":"agent_message","id":"01HEVTC0000000000000000005","parent_id":"01HEVTC0000000000000000004","ts":"2026-05-17T14:01:05.000Z","payload":{"text":"For approach B: ..."}}
```

### 18.4 Synthesized event

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000004","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"x-com-example-agent"},"vcs":{"type":"git","revision":"a1b2c3d4"}}
{"type":"user_message","id":"01HEVTD0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Add a logger"}}
{"type":"agent_message","id":"01HEVTD0000000000000000002","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Adding logger..."}}
{"type":"tool_call","id":"01HEVTD0000000000000000003","ts":"2026-05-17T14:00:06.000Z","payload":{"tool":"file_edit","args":{"path":"src/main.ts","diff":"--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,5 @@\n+import { logger } from './logger';\n+\n const main = () => {"}},"source":{"agent":"x-com-example-agent","original_type":"git_commit_diff","synthesized":true}}
```

### 18.5 Incomplete session

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000006","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"x-com-example-agent"}}
{"type":"user_message","id":"01HEVTF0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Run the test suite"}}
{"type":"tool_call","id":"01HEVTF0000000000000000002","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"shell_command","args":{"command":"npm test"}}}
{"type":"session_terminated","id":"01HEVTF0000000000000000003","ts":"2026-05-17T14:01:30.000Z","payload":{"reason":"eof_with_open_tool_calls","open_call_ids":["01HEVTF0000000000000000002"]},"source":{"synthesized":true}}
```

### 18.6 MCP call

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000005","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"x-com-example-agent"}}
{"type":"user_message","id":"01HEVTE0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Find my open Linear issues"}}
{"type":"tool_call","id":"01HEVTE0000000000000000002","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"mcp_call","args":{"server":"linear","tool":"list_issues","args":{"status":"open","assignee":"me"},"headers":{"Authorization":"[REDACTED]"}}}}
{"type":"tool_result","id":"01HEVTE0000000000000000003","ts":"2026-05-17T14:00:02.000Z","payload":{"for_id":"01HEVTE0000000000000000002","ok":true,"output":"[{\"id\":\"ABC-123\",\"title\":\"Fix auth\"}]"}}
```

---

## Changelog

### v0.1.0 (May 2026)

Initial public draft. v0.1.0 defines:

- JSONL file layout, session header, core event envelope, mandatory event types, optional events, the canonical tool taxonomy, vendor `meta` extensions (§8.0.3), tree semantics, layered validation, and artifact-level content addressing.
- Stable local source filenames (`spec.md`, `schema.json`) with immutable hosted release snapshots at `/spec/v0.1.0` and `/schema/v0.1.0.json`.
- The optional trail envelope record `type:"trail"` at line 1 (§8.0) with Tier 1 fields (`id`, `name`, `description`, `ts`, `producer`, `content_hash`) and Tier 2 fields (`tags`, `vcs`, `fork_from`, `redacted_from`, `sessions`, `meta`), and two-tier identity (§7.4): session-level `content_hash` excludes the envelope, file-level `content_hash` covers the whole file.
- Session headers may carry base `name`, `description`, and `tags`; `session_metadata_update` events replay on top of those base values. `vcs.type` allows reserved systems or `x-<vendor>/<name>` extensions, and envelope `fork_from.trail_id` uses the standard id shape.
- Multi-segment session primitives (`session_uid`, `segment.seq`, `segment.prev_content_hash`) and reconciliation invariants (§8.5).
- The optional header `stream` field, the `session_end` event, and the recommended `system_event` heartbeat convention (§8.4, §9.3).
- Tool-surface fidelity for truncated tool-call args, string-replacement `file_edit`, branch-scoped pairing warnings, stable user-query option ids, stricter attachment identity, and tool-result meta key hygiene.
- The `source.raw.envelope_ref` inline-first / ref-subsequent envelope dedup convention (§9.7), the `{ elided: true, size_bytes: N }` elide marker for `source.raw` (§14.1), and the writer-side redaction requirement for credential patterns in `source.raw`.
- Envelope-level `payload.usage` on the first entry derived from a source envelope, including `agent_message`, `agent_thinking`, and `tool_call` (§9.2).
- During the v0.1.0 draft cycle, planning snapshots moved from the legacy `tool_call.payload.tool:"task_plan"` shape to the canonical `task_plan_update` event. Final v0.1.0 writer-strict output MUST use `task_plan_update`; legacy `task_plan` tool calls are invalid.
- During the v0.1.0 draft cycle, writer-strict identity and encoding were hardened: ULIDs are uppercase, UUIDs are lowercase, timestamps carry schema `format:"date-time"` annotation, and strings with unpaired surrogates are invalid (`ill_formed_string`).

---

## Appendix A — Minimal valid record

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}
```

A session with only a header is valid. Events are optional.

### Appendix A.1 — Minimal valid record with trail envelope

```jsonl
{"type":"trail","schema_version":"0.1.0","id":"00000000-0000-0000-0000-000000000001","ts":"2026-05-17T14:00:00.000Z","producer":"trail-cli/0.3.0"}
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000001","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}
```

An envelope at line 1 followed by a session header at line 2 is valid. Events are optional.

## License

This specification is released under Apache-2.0.

---

*End of Agent Trail Specification v0.1.0*
