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
| **Trail file** | A JSONL file conforming to this specification. |
| **Trail envelope** | Optional `type:"trail"` record at line 1 carrying file-level metadata (producer, file label, file-scope hash, manifest, vendor extensions). Not part of the event graph. |
| **Header** | The session header (`type:"session"`). On line 1 when there is no envelope, on line 2 when the envelope is present. Not part of the event graph. |
| **Event** | Any object after the header line; one unit of session content. |
| **File-level content hash** | SHA-256 of the canonical bytes covering the whole file with the trail envelope's `content_hash` pinned to `<pending>`. |
| **Session-level content hash** | SHA-256 of the canonical bytes covering ONLY the session header and its events (envelope excluded), with the session header's `content_hash` pinned to `<pending>`. |
| **Entry** | Equivalent to "event"; either term may appear. |
| **Adapter** | Software that reads a source agent's storage and emits a trail file. |
| **Linear session** | A session whose events do not use `parent_id`. Events are ordered by file position. |
| **Tree session** | A session where some events use `parent_id` to form a DAG. |
| **Active leaf** | In a tree session, the last event in the file; the "current" position. |
| **Canonical event** | One of the five mandatory event types in §9. |
| **Raw trail** | A local artifact preserving source fidelity as much as possible. |
| **Redacted trail** | A separate artifact produced from a raw trail for sharing. It has its own `content_hash`. |
| **Shared trail** | A redacted trail transported through a sharing mechanism such as gist. |
| **Synthesized event** | An event the adapter constructed from indirect source data (e.g., a git diff), not mapped from a real source event. Flagged with `source.synthesized: true`. |
| **Content hash** | SHA-256 of the canonical bytes of the exact artifact (§7). |
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

Every session has a local identifier `id` in the header. ULID (26 Crockford base32 chars, case-insensitive) or UUID (RFC 4122, hyphenated or unhyphenated). The schema enforces this shape so cross-segment reconciliation can dedup events by id; older v0.1 fixtures whose ids were free-form strings have been migrated.

### 7.2 Artifact classes

Agent Trail distinguishes local fidelity from shared safety:

- **Raw trail:** the local artifact emitted by an adapter. It should preserve source fidelity, including `source.raw` where useful and safe.
- **Redacted trail:** a separate artifact produced from a raw trail for sharing. It removes or normalizes sensitive content and has its own `content_hash`.
- **Shared trail:** a redacted trail transported by a share tool. In v0.1.0, the reference transport is GitHub gist.

Redacted artifacts may include `redacted_from.content_hash` in the header to record provenance from the raw artifact. They must not expose the raw artifact's local path or local session identifier.

### 7.3 Content hash

Finalized artifacts should populate `content_hash` in the header. This is the SHA-256 of the exact artifact's canonical bytes, not a logical-session identifier shared across raw and redacted variants.

Canonical bytes are defined as:

- All JSONL lines in order.
- LF line endings.
- No trailing whitespace.
- A trailing newline at EOF.
- Each JSON object serialized using RFC 8785 JSON Canonicalization Scheme (JCS).

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

Event `id` values are globally unique. The schema enforces a ULID-or-UUID shape (see §7 / §17). Globally-unique ids let a reconciler dedup events across segments by exact string equality (spec §8.5 step 4).

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
    "trail_id": "<parent-file-id>",
    "content_hash": "<parent-file-hash>"            // optional
  },
  "redacted_from": {                                // optional; redacted artifacts only
    "content_hash": "<raw-file-content-hash>"
  },
  "sessions": [                                     // optional manifest
    { "id": "<session-id>", "agent": "<canonical-name>", "role": "...", "follows": "..." }
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
| `fork_from` | no | object | reference to a parent file when forked |
| `redacted_from` | no | object | provenance link from a redacted file to its raw counterpart |
| `sessions` | no | array | manifest of sessions in this file; validator warns on drift vs file content |
| `meta` | no | object | free-form vendor extensions (§8.0.3) |

The envelope MUST NOT carry a `parent_id`. It is not part of the event graph.

### 8.0.3 The `meta` extension convention

The trail envelope (§8.0), the session header (§8), and every event entry (§9.1) accept an optional `meta` object for vendor extensions, modelled on OCI image annotations and Kubernetes `metadata.annotations`. Object-typed values are allowed so nested data fits naturally. Keys SHOULD use a reverse-DNS or `x-<adapter>/` namespace to avoid collisions (`com.example.team`, `x-acme/build_id`, `io.entire.checkpoint_id`). The validator treats `meta` as opaque; it contributes to whichever `content_hash` tier covers its host record (§7.4): `meta` on the session header or any event entry feeds the session-level hash, and `meta` on the trail envelope feeds the file-level hash.

For verbatim source-event preservation, use `source.raw` (§9.6, §14.1) instead — `meta` is for cross-cutting annotations, not for capturing the source envelope.

No reserved keys ship in this draft. Standard keys may be promoted in later minor bumps based on observed usage.

### 8.0.4 The `sessions` manifest

When `sessions` is present, the validator warns if the manifest disagrees with the file:

- The manifest MUST list one entry per session group (§8.6) in file order. Each entry's `id` and `agent` MUST match the corresponding session header's `id` and `agent.name`. Length mismatch and per-entry drift both emit `envelope_sessions_manifest_drift` warnings — never errors, so renderers can still display the file.

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
    "type": "git" | "jj" | "hg" | "svn",
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
| `content_hash` | no | string | SHA-256 hex of this artifact; see §7.3 |
| `ts` | yes | string | ISO-8601 session start time; writers emit UTC `Z` with millisecond precision |
| `stream` | no | object | live-capture marker; see §8.4 |
| `agent.name` | yes | string | from the canonical registry (§13) |
| `agent.version` | no | string | source agent's version |
| `agent.model_default` | no | string | default model for the session |
| `cwd` | no | string | working directory; may be normalized for privacy |
| `vcs` | no | object | version control context at session time |
| `vcs.type` | yes (if `vcs` present) | enum | `git`, `jj`, `hg`, or `svn` |
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
| `source` | no | object | source-file metadata block (agent, path, format_version) |
| `meta` | no | object | vendor extensions; recommended keys use the reverse-DNS / `x-<adapter>/` convention (§8.0.3 / §11) |

`vcs.remote_url` provides a canonical project identifier that survives across users, machines, and clones — useful for cross-machine aggregation, profile filtering, and project-scoped analysis. Adapters that populate it:

- MUST normalize SSH and HTTPS variants of the same repository to a single canonical form. The reference normalization maps `git@host:org/repo.git`, `ssh://git@host/org/repo.git`, and `https://host/org/repo.git` to `https://host/org/repo` (strip trailing `.git`, strip userinfo, rewrite SSH to HTTPS).
- MUST strip embedded credentials (`https://user:pass@host/...` → `https://host/...`) before emission.
- SHOULD populate when the source agent records repository location or when `cwd` is detectably a versioned working directory. When the source declares multiple remotes (e.g., git `origin` plus `upstream`), prefer `origin`.
- MUST omit the field when no remote is configured — do not fabricate one.
- For submodules and worktrees, emit the remote of the outermost working tree's toplevel; `cwd` and `vcs.revision` disambiguate within.

Privacy: `remote_url` reveals repository identity (and may identify a private repo). Share tools strip or normalize it in redacted artifacts by default (§15).

When a trail file carries both header-level `vcs` (session-time context) and envelope-level `vcs` (file-assembly-time context, §8.0), they represent different observation points and there is no winner: tools rendering session state read `header.vcs`; tools rendering file provenance read `envelope.vcs`. File-assembly tools SHOULD preserve both when present. For multi-segment reconciliation rules, see §8.5.

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

- `session_uid` — globally-unique source-session identifier. Stable across **all** segments of one source session. Reconcilers group segments by exact string equality on `session_uid`. Format: ULID (recommended, lexicographic time-prefix; case-insensitive) or UUID (any RFC 4122 version, hyphenated or unhyphenated). Writers SHOULD emit `session_uid` even for single-segment trails, so a later segment can be reconciled against the first without rewriting the head. The schema enforces `session_uid` as required when `segment.seq >= 2` (multi-segment continuation MUST be linkable). The bundled claude-code and pi adapters derive `session_uid` deterministically from the upstream source-session id via RFC 4122 UUIDv5 with a per-adapter namespace UUID, so re-parsing the same upstream session is idempotent (see ADR-0006).

- `segment.seq` — 1-based integer identifying which segment of the session this file is. Single-segment trails MAY omit `segment` entirely, which is equivalent to `{seq: 1}`.

- `segment.prev_content_hash` — the **session-level** `content_hash` (§7.3) of the previous segment's finalized bytes. Required when `seq >= 2`. Forms a verifiable chain (HLS / Postgres-WAL pattern). If the previous segment was lost and the chain cannot be verified, writers MAY emit `null` and readers MUST emit a `segment_chain_break` warning.

#### Reconciliation algorithm

A reader presented with two or more segment trail files for one source session reconciles them by:

1. Group input files by `header.session_uid`.
2. Sort each group ascending by `header.segment.seq`.
3. Verify chain: for each segment with `seq > 1`, check that `header.segment.prev_content_hash` matches the previous segment's `header.content_hash`. Mismatch is a `segment_chain_mismatch` warning, not an error — readers MAY continue with the rest of the merge.
4. Concatenate events. Dedupe by event `id` (set membership). The schema enforces a ULID-or-UUID shape on every `id`, so cross-segment reconciliation can rely on string equality without further normalisation.
5. Drop intermediate `session_terminated` events with `payload.reason == "process_terminated"` — those are crash markers from killed writers; only the final terminator (if any) is kept.
6. Emit one merged trail with a single header. The merged header is assembled field-by-field across segments:
   - `ts` (session start time) comes from the lowest-`seq` segment (seg-1 represents the real start of the source session, not the most recent resume).
   - `stream`, `content_hash`, `vcs`, `cwd`, `agent.version`, `meta`, and any other late-binding metadata come from the highest-`seq` segment (these reflect the session's final or most recent observed state).
   - `id`, `type`, `schema_version`, `agent.name`, and `session_uid` are stable across segments by definition; readers SHOULD warn if they diverge.
   - `segment.*` fields are dropped from the merged header (the merge collapses the segment chain into one logical session).
   - Fields not enumerated above (e.g. `source`, vendor-namespaced extensions, future reserved fields) late-bind by default: readers SHOULD prefer the highest-`seq` segment's value. The default-late-binding rule keeps schema growth additive — new fields don't need a spec update to be reconciled. See [ADR-0006](docs/adr/0006-multi-segment-reconciler-and-id-tightening.md) for implementation notes, including the `agent.name` sub-field treatment when the rest of `agent.*` late-binds.

Whole-file graph rules (§16) apply **within** a segment, not across. Cross-segment references are out of scope for v0.1 (event `parent_id` chains do not span segments).

#### Writer guidance

- Writers SHOULD generate `session_uid` once per source session and reuse it for every segment.
- Writers SHOULD finalize each segment normally (compute `content_hash`, optionally append `session_terminated{reason: "process_terminated"}` for crash recovery) before starting a new segment.
- To produce `segment.prev_content_hash` for segment N, finalize segment N-1 per §7.3 and copy its session-level `content_hash` (lowercase hex sha256) verbatim into segment N's header.
- Recovered writers MAY emit `segment.prev_content_hash: null` when the previous segment is lost; the resulting chain break is a recoverable warning.

#### Composition with multi-session files

`session_uid` and `segment.*` sit at the **session-header** grain, not the file grain. A multi-session trail file (§8.6) may contain N session headers, each independently multi-segmentable. Reconcilers pre-split each input file into per-session sub-segments, then apply the group-by-`session_uid` algorithm above unchanged. The trail envelope (§8.0) is unaffected.

---

### 8.6 Multi-session trail files

A trail file MAY contain one OR more `(session header, events*)` groups concatenated. Boundaries are positional: a group extends from a `type:"session"` record up to (but excluding) the next `type:"session"` record, or to EOF. Single-session trails are the N=1 case and are unchanged.

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

When an extracted single session's recomputed `content_hash` does not match the value stored in the in-file header, readers SHOULD emit a warning rather than an error — canonicalization differences across writers can cause spurious mismatches that the reader can still display safely.

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

Every adapter must be able to emit these five when the source data contains the corresponding semantics. Readers must support them.

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

Attachment `uri` values in v0.1.0 are references, not inline binary payloads. Writers may use `https:`, local `file:` references for private/local trails, or content-addressed references such as `sha256:<hex>`. Inline `data:` payloads are deferred.

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
      "reasoning_tokens": 200
    }
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `text` | yes | string | the agent's output |
| `model` | no | string | model that produced this message |
| `stop_reason` | no | string | source-specific stop reason |
| `usage` | no | object | per-message token usage; see below |

##### `agent_message.payload.usage`

Captures per-message token accounting emitted by the source agent. Optional. When the source provides no token data, writers MUST omit `usage` — fabricating zeros is not allowed.

| Sub-field | Required | Type | Notes |
|---|---|---|---|
| `input_tokens` | conditional | integer ≥0 | delta for this message |
| `output_tokens` | conditional | integer ≥0 | delta for this message |
| `input_tokens_cumulative` | conditional | integer ≥0 | running total through this message |
| `output_tokens_cumulative` | conditional | integer ≥0 | running total through this message |
| `cache_read_tokens` | no | integer ≥0 | input tokens served from prompt cache; billed separately from `input_tokens` |
| `cache_creation_tokens` | no | integer ≥0 | input tokens written to prompt cache; billed separately from `input_tokens` |
| `reasoning_tokens` | no | integer ≥0 | output reasoning portion (Anthropic thinking, OpenAI reasoning) |

When `usage` is present, writers MUST emit at least one of (`input_tokens`, `input_tokens_cumulative`) AND at least one of (`output_tokens`, `output_tokens_cumulative`). Both shapes are supported because sources differ: Anthropic emits deltas, some Codex variants emit only cumulative totals. Readers SHOULD prefer the delta form and fall back to subtracting consecutive cumulative values.

Cache token semantics match Anthropic and OpenAI Responses API: `input_tokens` counts non-cached input only; `cache_read_tokens` and `cache_creation_tokens` are independent billing categories. Total billed input = `input_tokens + cache_read_tokens + cache_creation_tokens`. They are additive, not a subset of `input_tokens`.

Model identification for cost reporting uses `payload.model` first, falls back to `header.agent.model_default`, and is otherwise unknown. The `usage` object does not carry its own model field.

When a single source envelope fans out to multiple entries (text blocks, tool calls, thinking blocks sharing one API response), `usage` accounts for the whole envelope. Writers MUST attach it to the first `agent_message` derived from that envelope and MUST NOT repeat it on later derived entries. Tool calls and thinking blocks within the same envelope do not carry `usage`.

Latency and wall-clock cost fields are deferred to a future minor version; sources rarely expose them. Vendor extensions may use reverse-domain keys on the entry's `meta` field (§8.0.3) until standardized.

#### `tool_call`

The agent invoked a tool. Tool kinds use the taxonomy in §10.

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
| `tool` | yes | string | canonical tool kind (§10) |
| `args` | yes | object | tool-specific args |

#### `tool_result`

The result of a `tool_call`. References the call via `for_id`. Writers omit `for_id` when the source does not provide a reliable match. Readers may tolerate legacy/null values; when `for_id` is null or missing, see §9.5.

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
| `overflow_ref` | no | string | reference to full output |
| `error` | no | string | error message if `ok` is false |

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

`context_compact`, `user_interrupt`, and `model_change` are first-class record types (§9.3, §9.2). Do not duplicate them under `system_event.kind`.

##### Reserved lifecycle vocabulary

| `kind` | When to use |
| --- | --- |
| `session_start` | Explicit mid-stream session-start marker (header already covers, useful for tooling that splits on events). |
| `session_end` | Clean exit marker. |
| `turn_start` | User prompt accepted, agent begins work. |
| `turn_end` | Agent finishes a turn (Claude `Stop` hook equivalent). |
| `subagent_start` | A spawned subagent begins. |
| `subagent_end` | A spawned subagent returns. |
| `pre_tool_use` | Tool about to fire (hook intercept point). |
| `post_tool_use` | Tool finished. |
| `hook_fired` | Generic adapter-emitted hook trace. |
| `permission_request` | Agent asked the user for tool approval. |
| `permission_decision` | User allowed/denied a specific tool invocation. |
| `permission_mode_change` | Agent's tool-permission mode shifted (e.g., Claude Code: `default` / `acceptEdits` / `plan` / `bypassPermissions`). Distinct from per-tool `permission_decision`. |
| `cwd_change` | Working directory shifted. |
| `env_snapshot` | Shell/env state capture. |

##### Reserved source-signal vocabulary

| `kind` | When to use | Suggested `data` shape |
| --- | --- | --- |
| `task_started` | Source emits a structured task/step begin marker (Codex `task_started`, OpenCode part-start). | `{ task_id, title? }` |
| `task_completed` | Pair to `task_started`. May be synthesized at EOF for unclosed tasks (set `source.synthesized: true`). | `{ task_id, summary?, status? }` |
| `plan_completed` | Source emits a plan or todo completion marker (Codex `item_completed` with `item.type == "plan"`). | `{ plan_id, preview? }` |
| `turn_aborted` | Model or system stopped a turn for non-user reasons (length limit, refusal, error). Distinct from `user_interrupt`. | `{ reason }` |
| `tool_decision` | Source recorded a user approve/reject decision on a tool call (Cursor `tool_former_data.user_decision`). | `{ decision, tool_call_id }` |
| `hook_progress` | Catch-all for source-emitted progress/hook/queue records that do not map to a more specific reserved lifecycle kind. Adapters SHOULD prefer `session_start` / `session_end` / `turn_end` / `pre_tool_use` / `post_tool_use` / `subagent_end` / `hook_fired` when the source signal is unambiguous, and fall back to `hook_progress` only for unrecognised progress streams. | `{ hook_event?, hook_name?, ... }` |
| `queue_operation` | Source recorded an enqueue or dequeue operation. | Free-form. |
| `heartbeat` | Periodic liveness ping during streaming capture (§8.4). Optional. Non-normative; readers may treat as informational. | `{ interval_ms? }` |

##### Reserved diagnostic vocabulary

Cross-agent diagnostic signals. Adapters MAY emit these to surface non-fatal errors, warnings, deprecations, routing decisions, and hook failures in the timeline. Out of scope: per-tool errors (those stay on `tool_result.error` + `tool_result.ok=false`).

| `kind` | When to use | Suggested `data` shape |
| --- | --- | --- |
| `agent_error` | Agent-side error not tied to a specific tool call (Codex `Error`). | `{ severity?, code?, category?, blocking?, recovered?, source?, details? }` |
| `agent_warning` | Non-fatal agent-side warning (Codex `Warning`). | `{ severity?, code?, category?, blocking?, recovered?, source?, details? }` |
| `api_error` | Upstream LLM/API failure surfaced to the user (Claude Code `system.subtype=api_error`). | `{ severity?, code?, category?, source?, details? }` |
| `stream_error` | Streaming response interrupted or failed (Codex `StreamError`). | `{ severity?, code?, recovered?, details? }` |
| `deprecation_notice` | Source announced a feature or capability deprecation (Codex `DeprecationNotice`). | `{ feature?, replacement?, details? }` |
| `guardian_alert` | Safety rail, guardian system, or content moderation triggered (Codex `GuardianWarning`). | `{ severity?, policy?, action?, details? }` |
| `model_rerouted` | Model fallback or capability re-routing decision (Codex `ModelReroute`, `ModelVerification`). | `{ from?, to?, reason?, details? }` |
| `hook_failed` | Runtime hook execution failed, blocking or non-blocking (Claude Code `hook_blocking_error`, `hook_non_blocking_error`). | `{ severity?, blocking?, hook_name?, code?, details? }` |

**Severity vocabulary (informative).** When adapters include `data.severity`, recommended values are `info`, `warning`, `error`, `critical`. Not schema-enforced; readers SHOULD treat unknown severities as opaque.

**Source vocabulary (informative).** When `data.source` is present, common values include `anthropic`, `openai`, `hook`, `guardian`, `runtime`. Free-form at the schema layer.

##### Recommended `payload.data` shapes (permission kinds)

`data` stays freeform at the schema layer. Adapters SHOULD use the shapes below so cross-agent consumers can render permission flow without per-adapter switches. Promote to schema-enforced once 2+ adapters converge.

| `kind` | Recommended `data` |
| --- | --- |
| `permission_request` | `{ tool_call_id?: string, capability?: string, prompt?: string }` |
| `permission_decision` | `{ decision: "allow" \| "deny", tool_call_id?: string, capability?: string }` |
| `permission_mode_change` | `{ to: string, from?: string }` — `to` is the new mode (e.g., `default`, `acceptEdits`, `plan`, `bypassPermissions` for Claude Code). Adapters MAY use vendor-specific mode strings; cross-agent consumers SHOULD treat them as opaque tokens. |

##### Extension policy and promotion

- Reserved values above are the only bare strings allowed by writer-strict validation.
- Anything else must use `x-<adapter>/<name>` form, e.g. `x-claudecode/notification`.
- Readers are tolerant of unknown `x-*` kinds — they pass through with no diagnostic.
- Bare unknown strings (no `x-` prefix, not in the reserved set) are rejected by writer-strict validation.
- If an `x-*` kind proves cross-agent, promote it to the reserved enum in a minor format version bump. Document emitted kinds per adapter in `docs/parser-source-matrix.md`.

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

`level`: `low` | `medium` | `high` | `xhigh`.

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
    "tokens_after": 4000
  }
}
```

`trigger`: `manual` | `auto`.

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
  "payload": { "from_model": "<id>", "to_model": "<id>" }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `from_model` | no | string | previous model id; omit when the source did not track the prior model |
| `to_model` | yes | string | new active model id |

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

Adapters should populate `semantic.call_id` on tool_call/tool_result pairs when the source has its own IDs (especially Claude Code's `tool_use_id`, which can be null).

### 9.5 Tool call/result pairing

`tool_result.payload.for_id` should reference the matching `tool_call`. When it's null, missing, or refers to a non-existent event, readers use these fallback rules in order:

1. **Semantic match.** If both events have `semantic.call_id` and they're equal, pair them.
2. **Sequential match.** Pair the `tool_result` with the most recent prior unmatched `tool_call`.
3. **Heuristic match.** Readers may use further heuristics (timestamp proximity, payload shape) but must flag the pairing as uncertain in rendered output.

Writers should avoid relying on fallbacks. Populate `for_id` when reliable; use `semantic.call_id` when the source's native ID doesn't map cleanly to event `id`.

Validators apply the deterministic pairing rules when computing the "unmatched `tool_call` at EOF" warning (§16.4): explicit `for_id` reference first, then fallback rules 1 and 2 above (semantic match, sequential match). The heuristic rule (3) is reader-only — it produces uncertain pairings that readers must flag in rendered output, so validators do not apply it. A `tool_call` is considered matched when any of these deterministic methods pairs it with a `tool_result`.

### 9.6 Unknown event types

Readers must tolerate unknown types:

- Preserve them when round-tripping.
- Render with a generic fallback.
- Do not abort parsing.

Writers should not invent new top-level types. Use the `other` tool kind (§10) or `source.raw` for adapter-specific data, or `meta` (§8.0.3 / §11) for vendor extensions.

### 9.7 Source envelope referencing

When a single source envelope produces multiple entries — for example, an assistant message envelope whose `content` array is split across one `agent_message`, one `agent_thinking`, and one `tool_call` entry — writers should not inline the full envelope on every derived entry. Use *inline-first / ref-subsequent* dedup:

- The **first** entry derived from a given source envelope sets `source.raw.envelope` (and `source.raw.block`, `source.raw.block_index` if applicable).
- **Subsequent** entries derived from the same envelope set `source.raw.envelope_ref` to the first entry's `id`. They omit `source.raw.envelope` and keep `block` / `block_index`.

`source.raw.envelope_ref` is an optional string. Writers must ensure it references the `id` of an entry that appears **earlier** in the same file — the same envelope, inlined once. Forward references and dangling references are reader errors (`source_raw_envelope_ref_unresolved`, §16.4). The first-inline-then-ref shape is streaming-write friendly: readers resolve refs in a single pass without backtracking.

This mechanism is additive over v0.1.0. Readers that do not understand `envelope_ref` will see it as an unknown raw-source field and ignore it; the entry's other fields (`type`, `payload`, `semantic`) remain fully self-describing.

---

## 10. Canonical tool taxonomy

The `tool_call.payload.tool` field uses these values. Each defines the expected shape of `args`.

| Name | Args | Maps from |
|---|---|---|
| `file_read` | `{ path, range? }` | Claude Code `Read`, Pi `read`, Cursor file-open |
| `file_write` | `{ path, content }` | Claude Code `Write`, Pi `write` |
| `file_edit` | `{ path, diff }` (unified diff) | Claude Code `Edit`, Pi `edit`, Aider git diffs |
| `file_search` | `{ query, path?, glob? }` | Claude Code `Grep`/`Glob`, ripgrep-like source search |
| `shell_command` | `{ command, cwd?, timeout? }` | Claude Code `Bash`, Pi `bash` |
| `shell_output` | `{ command_id? }` | Follow-up reads from a long-running shell command |
| `mcp_call` | `{ server, tool, args, headers? }` | MCP invocations |
| `web_fetch` | `{ url, method?, headers? }` | Claude Code `WebFetch`, Pi web tool |
| `web_search` | `{ query }` | Web search tools distinct from fetching a known URL |
| `notebook_edit` | `{ path, cell_id?, diff?, content? }` | Notebook cell edits |
| `task_plan` | `{ text?, items? }` | Todo/planning tools such as `TodoWrite` |
| `subagent_invoke` | `{ task, agent_type?, session_id? }` | Claude Code `Task`, Cursor background agent |
| `other` | `{ name, args }` | Anything not covered above |

### 10.1 `file_edit`

The `diff` is a unified diff:

```diff
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,4 +1,4 @@
 unchanged
-removed
+added
 unchanged
```

Adapters with native before/after content must convert to a diff before emitting. Adapters with only git diffs (Aider) emit directly and set `source.synthesized: true`.

### 10.2 `shell_command`

Full command in `command`; output in the corresponding `tool_result.payload.output`. Redactors should scrub env vars, `Authorization` headers in piped curls, etc.

### 10.3 `mcp_call`

- `server` — MCP server identifier (e.g., `github`, `linear`).
- `tool` — tool name within that server.
- `headers` — should be redacted before writing: `Authorization`, `X-API-Key`, `Cookie`, `Bearer ...`.

### 10.4 `subagent_invoke`

Indicates a child conversation was spawned. Two cases:

- **Same file:** child events use this event's `id` as their root `parent_id`. The child is a subtree.
- **Separate file:** set `session_id` to the child file's session id or content hash. The child events aren't in this file.

### 10.5 The `other` escape hatch

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

The `meta` field is for fields outside the canonical vocabulary. For verbatim source-event preservation, use `source.raw` (§14.1) instead. See §8.0.3 for the full convention.

---

## 12. Tree and branching

### 12.1 When to emit `parent_id`

`parent_id` represents tree topology, not ordinary linear sequencing. Linear sessions use file order. Tool call/result pairing uses `tool_result.payload.for_id` and `semantic.call_id`, not `parent_id`.

Adapters should emit `parent_id`:

- For all events when the source has a native tree (Pi, OpenClaw).
- For events that are children of a subagent invocation (Claude Code `Task`, Cursor background agents) — the root of the subtree uses the parent's `subagent_invoke` event id.
- For detected user rewinds where the adapter can reconstruct branch points (best-effort).

Adapters should omit `parent_id` for agents with linear conversations and no subagents (Codex CLI, OpenCode, Aider, ChatGPT).

### 12.2 Reader behavior

Linear-only readers:

- Treat events in file order.
- Render `branch_summary` events as inline callouts.
- Display a notice if the file contains tree topology that they cannot render fully.

Tree-aware readers:

- Build the parent graph.
- Active leaf is the last event in the file.
- Active path is leaf-to-root.
- Other paths are abandoned branches.

### 12.3 Acyclicity

The `parent_id` graph must be acyclic. The header isn't part of the graph; nothing references it via `parent_id`.

---

## 13. Canonical agent registry

Lowercase, hyphenated:

`claude-code`, `pi`, `openclaw`, `codex-cli`, `cursor`, `opencode`, `aider`, `amp`, `cline`, `crush`, `kimi-code`, `qwen-code`, `factory`, `vibe`, `copilot-cli`, `copilot-chat`, `chatgpt`, `clawdbot`.

The registry reserves canonical names. It does not imply that the official adapter package currently supports every registered agent. Supported adapters are listed in the PRD, package metadata, and parser source matrix.

New agents may be added by amending this spec. Until registered, adapters may use a custom reverse-domain name prefixed `x-` (e.g., `x-com-example-myagent`) to reduce collisions.

---

## 14. Truncation, overflow, and raw source size

Writers MAY truncate large `tool_result` outputs to keep trails tractable. The wire format records truncation with two fields on `tool_result.payload`:

| Field | Type | Notes |
|---|---|---|
| `truncated` | boolean | `true` when `output` was shortened from its original length |
| `overflow_ref` | string | optional content-addressed reference to the full output (e.g., `sha256:<hex>`); colocated blob storage is implementation-defined |

Specific inline-size thresholds, the truncation algorithm (e.g., head-only, head-and-tail, line-aligned), and the choice of overflow storage are writer policy and belong in writer documentation, not the format.

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

Adapters and share tools should:

- Redact known secret patterns before writing tool outputs.
- Normalize working directory paths when sharing.
- Strip or warn about embedded images.
- Cap inline output sizes per §14.
- Strip or normalize `vcs.remote_url` (§8.2) in redacted artifacts unless the user opts in. The field reveals repository identity, including private repositories.

A complete redaction protocol is out of scope for the file format; it belongs to share tooling. Redacted artifacts may record `redacted_from.content_hash` to link back to the raw artifact without exposing local paths or raw local IDs.

Token-usage objects (`agent_message.payload.usage`, §9.2) are preserved in redacted artifacts by default — they carry no PII and are needed for downstream cost reporting. Share tools that need to strip usage can do so via a future metadata-strip flag.

---

## 16. Validation

Validation is layered because JSON Schema validates one line at a time, while several Agent Trail rules require whole-file context.

### 16.1 Writer schema

`schema.json` is the writer-strict schema for v0.1.0. It validates a single JSON object line and requires header lines to use `schema_version: "0.1.0"`. Writers use this schema for emitted header and event lines.

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

If `content_hash` is present:

7. The value is 64 hex characters (SHA-256).
8. Strict validators recompute and verify per §7.3. On mismatch, strict validation fails. Reader-tolerant parsers may warn but must not abort.

Warnings (non-fatal):

- Each `tool_call.id` should be referenced by exactly one `tool_result.payload.for_id` (or paired via §9.5).
- `subagent_invoke` events should have descendants in this file or set `session_id` pointing elsewhere.
- `branch_summary.payload.abandoned_branch_id` should reference a real branch root.
- Writers should emit `session_terminated` if any `tool_call` remains unmatched at EOF. The warning code is `unmatched_tool_call_at_eof`. Suppression:
  - A `session_end` event anywhere in the file suppresses this warning for every unmatched `tool_call` (clean conclusion, §9.3).
  - A `session_terminated` event whose `payload.open_call_ids` lists a given `tool_call.id` suppresses the warning for that id only (explicit acknowledgement). A `session_terminated` event without `open_call_ids` does not suppress the warning.
- `session_end.payload.final_message_id`, when present, should reference an `id` that appears in the same file (the session header or a prior event). A dangling reference is a warning with code `unknown_final_message_id` at `/payload/final_message_id`.
- Validators MAY report implementation-defined size budgets for `source.raw`. The reference validator emits `source_raw_oversized` (warning) above a soft threshold and `source_raw_oversized_hard` (error) above a hard threshold; specific numbers are writer policy (§14.1).
- `source.raw` should not contain unredacted credentials. A string leaf matching a known credential pattern emits `source_raw_unredacted_secret` (warning) at the matching JSON pointer.
- `source.raw.envelope_ref`, when set, must reference the `id` of an earlier entry in the same file (§9.7). Dangling or forward references are errors with code `source_raw_envelope_ref_unresolved` at `/source/raw/envelope_ref`.
- Trail envelope position and uniqueness (§8.0):
  - `envelope_not_at_line_1` (error): a `type:"trail"` record appears on a line other than line 1.
  - `multiple_envelopes` (error): more than one envelope appears in the file.
  - `missing_header_after_envelope` (error): an envelope at line 1 is not followed by a session header on line 2.
  - `envelope_sessions_manifest_drift` (warning): the envelope's `sessions` manifest disagrees with the session header's `id` or `agent`, or lists a number of sessions other than one.

Streaming rules (§8.4) are evaluated against the *current* header `stream.state` at validation time — the validator reads the present value, not a history of transitions. Crash-recovery writers MUST finalize (`stream.state` to `"closed"` or remove `stream`) before appending terminal events; once the stream is no longer marked live, the rules below stop applying.

9. If the current `header.stream.state == "open"`:
   - **9a.** `content_hash` should be absent or `"<pending>"`. A populated hex hash is a warning, since the canonical bytes are still in flux.
   - **9b.** Terminal events (`session_end`, `session_terminated`) should not appear. A terminal event in a file whose current `header.stream.state == "open"` is a warning — the writer claims the stream is still open but has already emitted a terminal event. Finalize the header (set `stream.state` to `"closed"` or remove `stream`) before appending terminal events.
10. If the current `header.stream.state == "closed"` or `stream` is absent, finalized artifacts should populate `content_hash`. Readers may warn but must not abort when it is missing on otherwise complete files. Trail files produced by stream-unaware writers, or files appended across crashes and recoveries, may contain both `session_end` and `session_terminated` legitimately; rule 9b does not apply once the stream is no longer marked live.

---

## 17. Formal schema

The normative writer-strict JSON Schema lives in `schema.json` and is published at `https://agent-trail.dev/schema/v0.1.0.json`.

This spec intentionally does not duplicate the full schema inline. Implementations should validate each JSONL line against `schema.json`, then run the whole-file checks in §16.4. Reader-tolerant parsing is separate from writer-strict schema validation.

---

## 18. Examples

### 18.1 Session with tool calls and semantic pairing

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000002","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"claude-code"}}
{"type":"user_message","id":"01HEVTB0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Read package.json"}}
{"type":"tool_call","id":"01HEVTB0000000000000000002","ts":"2026-05-17T14:00:06.000Z","payload":{"tool":"file_read","args":{"path":"package.json"}},"semantic":{"call_id":"toolu_01abc"}}
{"type":"tool_result","id":"01HEVTB0000000000000000003","ts":"2026-05-17T14:00:06.000Z","payload":{"for_id":"01HEVTB0000000000000000002","ok":true,"output":"{\"name\":\"trail\"}"},"semantic":{"call_id":"toolu_01abc","tool_kind":"file_read"}}
{"type":"agent_message","id":"01HEVTB0000000000000000004","ts":"2026-05-17T14:00:08.000Z","payload":{"text":"Your package is called trail."}}
```

### 18.2 Tool result with missing for_id (fallback pairing)

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS000000000000000002B","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"claude-code"}}
{"type":"user_message","id":"01HEVTX0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Read package.json"}}
{"type":"tool_call","id":"01HEVTX0000000000000000002","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"file_read","args":{"path":"package.json"}},"semantic":{"call_id":"toolu_xyz"}}
{"type":"tool_result","id":"01HEVTX0000000000000000003","ts":"2026-05-17T14:00:02.000Z","payload":{"ok":true,"output":"{\"name\":\"trail\"}"},"semantic":{"call_id":"toolu_xyz"}}
```

The reader pairs `01HEVTX0000000000000000003` to `01HEVTX0000000000000000002` via `semantic.call_id` (rule §9.5 step 1).

### 18.3 Tree with abandoned branch

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000003","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"pi"}}
{"type":"user_message","id":"01HEVTC0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Try approach A"}}
{"type":"agent_message","id":"01HEVTC0000000000000000002","parent_id":"01HEVTC0000000000000000001","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Approach A: ..."}}
{"type":"user_message","id":"01HEVTC0000000000000000003","parent_id":"01HEVTC0000000000000000001","ts":"2026-05-17T14:01:00.000Z","payload":{"text":"Actually, try approach B"}}
{"type":"branch_summary","id":"01HEVTC0000000000000000004","parent_id":"01HEVTC0000000000000000003","ts":"2026-05-17T14:01:01.000Z","payload":{"abandoned_branch_id":"01HEVTC0000000000000000002","summary":"Approach A explored but didn't work because of X"}}
{"type":"agent_message","id":"01HEVTC0000000000000000005","parent_id":"01HEVTC0000000000000000004","ts":"2026-05-17T14:01:05.000Z","payload":{"text":"For approach B: ..."}}
```

### 18.4 Synthesized event (Aider)

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000004","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"aider"},"vcs":{"type":"git","revision":"a1b2c3d4..."}}
{"type":"user_message","id":"01HEVTD0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Add a logger"}}
{"type":"agent_message","id":"01HEVTD0000000000000000002","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Adding logger..."}}
{"type":"tool_call","id":"01HEVTD0000000000000000003","ts":"2026-05-17T14:00:06.000Z","payload":{"tool":"file_edit","args":{"path":"src/main.ts","diff":"--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,5 @@\n+import { logger } from './logger';\n+\n const main = () => {"}},"source":{"agent":"aider","original_type":"git_commit_diff","synthesized":true}}
```

### 18.5 Incomplete session

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000006","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"claude-code"}}
{"type":"user_message","id":"01HEVTF0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Run the test suite"}}
{"type":"tool_call","id":"01HEVTF0000000000000000002","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"shell_command","args":{"command":"npm test"}}}
{"type":"session_terminated","id":"01HEVTF0000000000000000003","ts":"2026-05-17T14:01:30.000Z","payload":{"reason":"eof_with_open_tool_calls","open_call_ids":["01HEVTF0000000000000000002"]},"source":{"synthesized":true}}
```

### 18.6 MCP call

```jsonl
{"type":"session","schema_version":"0.1.0","id":"01HSESS0000000000000000005","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"claude-code"}}
{"type":"user_message","id":"01HEVTE0000000000000000001","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Find my open Linear issues"}}
{"type":"tool_call","id":"01HEVTE0000000000000000002","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"mcp_call","args":{"server":"linear","tool":"list_issues","args":{"status":"open","assignee":"me"},"headers":{"Authorization":"[REDACTED]"}}}}
{"type":"tool_result","id":"01HEVTE0000000000000000003","ts":"2026-05-17T14:00:02.000Z","payload":{"for_id":"01HEVTE0000000000000000002","ok":true,"output":"[{\"id\":\"ABC-123\",\"title\":\"Fix auth\"}]"}}
```

---

## Changelog

### v0.1.0 (May 2026)

Initial public draft. v0.1.0 defines:

- JSONL file layout, session header, core event envelope, five mandatory event types, optional events, the canonical tool taxonomy, vendor `meta` extensions (§8.0.3), tree semantics, layered validation, and artifact-level content addressing.
- Stable local source filenames (`spec.md`, `schema.json`) with immutable hosted release snapshots at `/spec/v0.1.0` and `/schema/v0.1.0.json`.
- The optional trail envelope record `type:"trail"` at line 1 (§8.0) with Tier 1 fields (`id`, `name`, `description`, `ts`, `producer`, `content_hash`) and Tier 2 fields (`tags`, `vcs`, `fork_from`, `redacted_from`, `sessions`, `meta`), and two-tier identity (§7.4): session-level `content_hash` excludes the envelope, file-level `content_hash` covers the whole file.
- Multi-segment session primitives (`session_uid`, `segment.seq`, `segment.prev_content_hash`) and the reconciliation algorithm (§8.5).
- The optional header `stream` field, the `session_end` event, and the recommended `system_event` heartbeat convention (§8.4, §9.3).
- The `source.raw.envelope_ref` inline-first / ref-subsequent envelope dedup convention (§9.7), the `{ elided: true, size_bytes: N }` elide marker for `source.raw` (§14.1), and the writer-side redaction requirement for credential patterns in `source.raw`.

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

---

## Appendix B — Design rationale

- **JSONL over JSON:** streamable, append-friendly, line-grep-able, no parser-bomb risk.
- **Optional `parent_id`:** most agents produce linear sessions; tree complexity should be paid only by sessions that need it.
- **`source.raw` escape hatch:** lets adapters preserve everything the canonical model loses; enables lossless round-trip for source-aware tools.
- **Five mandatory event types:** minimum semantic surface for a useful viewer; everything else is optional.
- **Fixed tool taxonomy:** cross-agent search and rendering depend on shared tool names.
- **No runtime fields:** active leaf pointers, in-memory caches, etc. are reader concerns and not in the file.
- **Header outside the event graph:** the header is metadata about the file, not a participant in the conversation.
- **Content-addressed identity:** finalized artifacts get a verifiable hash; enables dedup and tamper-evidence without treating hash lookup as a v0.1.0 transport.
- **Semantic linking with fallback:** real source data has missing or null IDs; the spec must work with imperfect inputs.
- **`session_terminated`:** incomplete sessions are real; naming the condition lets renderers handle them gracefully.
- **Vendor `meta` with reverse-domain keys:** lets implementations extend without collisions, without growing the canonical vocabulary, and without requiring a central registry.

---

## Appendix C — FAQ

**Why JSONL instead of one big JSON object?**

Streamability and tooling. You can `tail -f` a trail file as it's being written. You can `grep`, `head`, `jq -s`, and pipe it. A single JSON object would require buffering the whole session for any operation and would lose append-friendliness.

**How should I store trail files?**

The spec is unopinionated. Local files, gist, git notes, S3, a database — anything. Sharing tools may have conventions, but the format itself doesn't.

**What if I encounter an agent I don't have an adapter for?**

Either write one (see §13 for the registry; use a reverse-domain `x-<domain>-<name>` for unregistered agents) or use a generic export tool that emits the source agent's events under the `other` tool kind with `source.raw` preserving the original data.

**What about live or streaming sessions?**

A v0.1.x file may be appended to in real time. Writers set the header's `stream.state` to `"open"` while appending and omit (or use `"<pending>"`) for `content_hash`. On finalize, the writer rewrites the header with `stream` removed or set to `state: "closed"` and computes `content_hash` per §7.3. Adapters may append a `session_end` event to mark a clean conclusion (vs. `session_terminated` for abnormal ends). Optional `system_event` records of `kind: "heartbeat"` can act as a liveness ping. See §8.4 for the full lifecycle.

**How big is too big for a single file?**

The spec doesn't impose limits. Practical guidance: keep individual files under ~100 MB for tooling-friendliness. For very large sessions, multi-file sharding is deferred to v0.2.

**Can I extend the format with custom data?**

Yes, three ways depending on the data:

1. **Verbatim source preservation:** put it in `source.raw`.
2. **Vendor extension with semantics:** put it in `meta` (§8.0.3) with a reverse-domain key (`com.example.field`).
3. **Source-agent-specific tools:** use `tool: "other"` with `args: { name, args }`.

Don't invent new top-level event types in v0.1.x.

**How do I handle agent updates that change the source format?**

Pin your adapter to a specific source-agent version in tests. When the source format changes, update the adapter and document the verification in your parser source matrix. Adapters that ignore source schema drift will silently produce wrong output.

**Why isn't redaction part of the spec?**

Redaction policy varies by context (unlisted gist vs public dataset vs HF upload). Building it into the raw format would couple data shape to threat model. Share tooling owns redaction by producing a separate redacted artifact with its own `content_hash`.

**What is the relationship to Agent Trace, OpenSession, HAIL, etc.?**

Agent Trail is a session content format. [Agent Trace](https://agent-trace.dev) is a code attribution format. These are at different layers and can interoperate (an Agent Trace `conversation.url` can point to a trail file). OpenSession (hwisu/opensession) and HAIL JSONL are independent prior art with different design goals — see Appendix D.

---

## Appendix D — Acknowledgements

Agent Trail draws on prior art:

- **[badlogic/pi-mono](https://github.com/badlogic/pi-mono)** (Mario Zechner). Pi's JSONL format pioneered patterns Agent Trail adopts: append-only JSONL, header-as-first-line, type discriminator, id/parentId graph, versioned schema with migration, branch summaries.
- **[hwisu/opensession](https://github.com/hwisu/opensession)** — independent prior work on AI session normalization. Agent Trail adopts ideas of content-addressed identity (SHA-256 of canonical bytes), semantic linking with fallback pairing, synthetic termination events.
- **[Dicklesworthstone/coding_agent_session_search (cass)](https://github.com/Dicklesworthstone/coding_agent_session_search)** — empirical research on parsing 19 coding agents; storage path documentation.
- **[Agent Trace](https://agent-trace.dev)** (Cursor and partners) — spec-writing patterns: motivation-first opening, terminology section, vendor extension via reverse-domain notation, MIME type with `vnd.` prefix.
- **[agentation.com](https://agentation.com)** — spec design: tiered fields, event envelope, versioned schema URLs.
- **[luoyuctl/agenttrace](https://github.com/luoyuctl/agenttrace)** — multi-agent observability with parser-guide documentation.

Where Agent Trail diverges from prior art, it is because the design goal is lossy-but-portable interchange rather than runtime persistence or vertical product use. Prior art served different goals; their format choices reflect those goals appropriately.

---

## License

This specification is released under Apache-2.0.

---

*End of Agent Trail Specification v0.1.0*
