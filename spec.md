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
{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}
{"type":"user_message","id":"evta1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"hello"}}
{"type":"agent_message","id":"evta2","ts":"2026-05-17T14:00:07.000Z","payload":{"text":"hi"}}
```

Line 1 is the header. Lines 2 and on are events. Everything else is optional structure layered on top.

---

## 4. Terminology

| Term | Definition |
|---|---|
| **Trail file** | A JSONL file conforming to this specification. |
| **Header** | The single object on line 1; metadata about the file. Not part of the event graph. |
| **Event** | Any object on line 2 or later; one unit of session content. |
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
- MIME type: `application/vnd.trail+jsonl`
- Editors render as JSON via the `.jsonl` suffix. A dedicated language extension may provide richer highlighting later.

### 5.2 Encoding

- UTF-8, no BOM.
- LF line endings (`\n`). CRLF is tolerated by readers; writers must not produce it.
- Each line is one self-contained JSON object.
- Empty lines are not allowed.
- A trailing newline at EOF is recommended but not required.

### 5.3 File layout

Every valid trail file has:

1. Exactly one header line (line 1).
2. Zero or more event lines (lines 2 onward).

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

Every session has a local identifier `id` in the header. UUID, ULID, or any 4+ char unique string. Writers use this for in-progress sessions. It is not required to be globally unique outside the file.

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

### 7.4 Event identifiers

Event `id` values are unique within the file. They do not need to be globally unique. Recommended: 8+ characters, hex or alphanumeric.

---

## 8. The header

### 8.1 Schema

```jsonc
{
  "type": "session",
  "schema_version": "0.1.0",
  "id": "<session-uuid-or-ulid>",
  "content_hash": "<sha256-hex>",               // optional; populated at finalize
  "ts": "<ISO-8601 timestamp>",
  "agent": {
    "name": "<canonical-agent-name>",
    "version": "<source-agent-version>",        // optional
    "model_default": "<model-id>"               // optional
  },
  "cwd": "<absolute-path-or-normalized>",       // optional
  "vcs": {                                      // optional
    "type": "git" | "jj" | "hg" | "svn",
    "revision": "<sha-or-change-id>"
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
  "metadata": {                                 // optional; see §11
    "com.example.custom_field": "..."
  }
}
```

### 8.2 Fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | literal `"session"` | discriminator |
| `schema_version` | yes | string | currently `"0.1.0"` |
| `id` | yes | string | UUID, ULID, or 4+ char alphanumeric |
| `content_hash` | no | string | SHA-256 hex of this artifact; see §7.3 |
| `ts` | yes | string | ISO-8601 session start time; writers emit UTC `Z` with millisecond precision |
| `agent.name` | yes | string | from the canonical registry (§13) |
| `agent.version` | no | string | source agent's version |
| `agent.model_default` | no | string | default model for the session |
| `cwd` | no | string | working directory; may be normalized for privacy |
| `vcs` | no | object | version control context at session time |
| `fork_from` | no | object | reference to a parent session if forked |
| `redacted_from` | no | object | provenance link from a redacted artifact to the raw artifact hash |
| `source` | no | object | metadata about the source file |
| `metadata` | no | object | vendor extensions (§11) |

### 8.3 Example

```json
{"type":"session","schema_version":"0.1.0","id":"01HM7K5R9X2QZJ8VD6W4P3T1F0","content_hash":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","ts":"2026-05-17T14:02:00.000Z","agent":{"name":"claude-code","version":"2.1.42","model_default":"claude-sonnet-4-5"},"cwd":"<cwd>","vcs":{"type":"git","revision":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"}}
```

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
    "raw": { /* opaque source object */ },
    "synthesized": false
  },
  "metadata": {                                 // optional; see §11
    "com.example.field": "..."
  }
}
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `type` | yes | string | event type; see §9.2-9.3 |
| `id` | yes | string | unique within the file |
| `parent_id` | no | string | references another `id` for tree topology; absent = linear file order |
| `ts` | yes | string | ISO-8601 timestamp |
| `payload` | yes | object | type-specific data |
| `semantic` | no | object | linking metadata for fallback pairing |
| `source` | no | object | adapter-provided source metadata |
| `metadata` | no | object | vendor extensions (§11) |

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
    "stop_reason": "end_turn"
  }
}
```

| Payload field | Required | Type | Notes |
|---|---|---|---|
| `text` | yes | string | the agent's output |
| `model` | no | string | model that produced this message |
| `stop_reason` | no | string | source-specific stop reason |

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
    "kind": "progress",
    "text": "Hook progress: PreToolUse",
    "data": { "hook": "PreToolUse" }
  }
}
```

`kind` is a short normalized category such as `system`, `progress`, `queue_operation`, `hook_progress`, or `status`. `data` is curated structured metadata for rendering and search, not a replacement for `source.raw`.

Recommended `kind` values when an adapter encounters these source signals. The set is open; adapters may add new kinds with reverse-domain prefixes for vendor extensions. Use these strings verbatim when applicable so timelines stay consistent across agents.

| `kind` | When to use | Suggested `data` shape |
| --- | --- | --- |
| `task_started` | Source emits a structured task/step begin marker (Codex `task_started`, OpenCode part-start). | `{ task_id, title? }` |
| `task_completed` | Pair to `task_started`. May be synthesized at EOF for unclosed tasks (set `source.synthesized: true`). | `{ task_id, summary?, status? }` |
| `plan_completed` | Source emits a plan or todo completion marker (Codex `item_completed` with `item.type == "plan"`). | `{ plan_id, preview? }` |
| `turn_aborted` | Model or system stopped a turn for non-user reasons (length limit, refusal, error). Distinct from `user_interrupt`. | `{ reason }` |
| `tool_decision` | Source recorded a user approve/reject decision on a tool call (Cursor `tool_former_data.user_decision`). | `{ decision, tool_call_id }` |
| `hook_progress` | Source emitted a progress, hook, or queue lifecycle record (Claude Code `progress`, hook events). | `{ hook_event?, hook_name?, ... }` |
| `queue_operation` | Source recorded an enqueue or dequeue operation. | Free-form. |

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

### 9.6 Unknown event types

Readers must tolerate unknown types:

- Preserve them when round-tripping.
- Render with a generic fallback.
- Do not abort parsing.

Writers should not invent new top-level types. Use the `other` tool kind (§10) or `source.raw` for adapter-specific data, or `metadata` (§11) for vendor extensions.

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

Implementations and vendors can add custom data via `metadata` fields on the header or any event. Use reverse-domain notation for keys to avoid collisions:

```jsonc
"metadata": {
  "com.cursor.workspace_id": "ws-abc123",
  "dev.example.custom_flag": true,
  "io.anthropic.usage": { "input_tokens": 1234, "output_tokens": 567 }
}
```

Readers may preserve, ignore, or render `metadata` fields. They must not abort on unknown keys.

The `metadata` field is for fields outside the canonical vocabulary. For verbatim source-event preservation, use `source.raw` instead.

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

Tool outputs can exceed reasonable inline limits. Recommended handling:

- Default inline limit: 10 KB per tool output.
- When exceeded:
  - Set `tool_result.payload.truncated: true`.
  - Truncate `output` to ~9 KB.
  - Optionally set `overflow_ref` to a content-addressed reference (`sha256:abc...`).
  - Implementations storing overflow externally should colocate the blob with the JSONL.

Limits and storage strategy are implementation-defined; the spec only defines the data shape.

`source.raw` is optional. Writers should omit or summarize very large or sensitive raw source objects when they would make trail files unwieldy or unsafe. Share tools must inspect `source.raw` during redaction before producing a shared artifact.

---

## 15. Redaction

The raw file format does not mandate redaction. Sharing tools produce a separate redacted artifact before upload. Raw and redacted artifacts have different `content_hash` values.

Adapters and share tools should:

- Redact known secret patterns before writing tool outputs.
- Normalize working directory paths when sharing.
- Strip or warn about embedded images.
- Cap inline output sizes per §14.

A complete redaction protocol is out of scope for the file format; it belongs to share tooling. Redacted artifacts may record `redacted_from.content_hash` to link back to the raw artifact without exposing local paths or raw local IDs.

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

1. First line matches the header schema with `type: "session"` and `schema_version: "0.1.0"`.
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
- Writers should emit `session_terminated` if any `tool_call` remains unmatched at EOF.

---

## 17. Formal schema

The normative writer-strict JSON Schema lives in `schema.json` and is published at `https://agent-trail.dev/schema/v0.1.0.json`.

This spec intentionally does not duplicate the full schema inline. Implementations should validate each JSONL line against `schema.json`, then run the whole-file checks in §16.4. Reader-tolerant parsing is separate from writer-strict schema validation.

---

## 18. Examples

### 18.1 Session with tool calls and semantic pairing

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess2","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"claude-code"}}
{"type":"user_message","id":"evtb1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Read package.json"}}
{"type":"tool_call","id":"evtb2","ts":"2026-05-17T14:00:06.000Z","payload":{"tool":"file_read","args":{"path":"package.json"}},"semantic":{"call_id":"toolu_01abc"}}
{"type":"tool_result","id":"evtb3","ts":"2026-05-17T14:00:06.000Z","payload":{"for_id":"evtb2","ok":true,"output":"{\"name\":\"trail\"}"},"semantic":{"call_id":"toolu_01abc","tool_kind":"file_read"}}
{"type":"agent_message","id":"evtb4","ts":"2026-05-17T14:00:08.000Z","payload":{"text":"Your package is called trail."}}
```

### 18.2 Tool result with missing for_id (fallback pairing)

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess2b","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"claude-code"}}
{"type":"user_message","id":"evtx1","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Read package.json"}}
{"type":"tool_call","id":"evtx2","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"file_read","args":{"path":"package.json"}},"semantic":{"call_id":"toolu_xyz"}}
{"type":"tool_result","id":"evtx3","ts":"2026-05-17T14:00:02.000Z","payload":{"ok":true,"output":"{\"name\":\"trail\"}"},"semantic":{"call_id":"toolu_xyz"}}
```

The reader pairs `evtx3` to `evtx2` via `semantic.call_id` (rule §9.5 step 1).

### 18.3 Tree with abandoned branch

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess3","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"pi"}}
{"type":"user_message","id":"evtc1","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Try approach A"}}
{"type":"agent_message","id":"evtc2","parent_id":"evtc1","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Approach A: ..."}}
{"type":"user_message","id":"evtc3","parent_id":"evtc1","ts":"2026-05-17T14:01:00.000Z","payload":{"text":"Actually, try approach B"}}
{"type":"branch_summary","id":"evtc4","parent_id":"evtc3","ts":"2026-05-17T14:01:01.000Z","payload":{"abandoned_branch_id":"evtc2","summary":"Approach A explored but didn't work because of X"}}
{"type":"agent_message","id":"evtc5","parent_id":"evtc4","ts":"2026-05-17T14:01:05.000Z","payload":{"text":"For approach B: ..."}}
```

### 18.4 Synthesized event (Aider)

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess4","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"aider"},"vcs":{"type":"git","revision":"a1b2c3d4..."}}
{"type":"user_message","id":"evtd1","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Add a logger"}}
{"type":"agent_message","id":"evtd2","ts":"2026-05-17T14:00:05.000Z","payload":{"text":"Adding logger..."}}
{"type":"tool_call","id":"evtd3","ts":"2026-05-17T14:00:06.000Z","payload":{"tool":"file_edit","args":{"path":"src/main.ts","diff":"--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,5 @@\n+import { logger } from './logger';\n+\n const main = () => {"}},"source":{"agent":"aider","original_type":"git_commit_diff","synthesized":true}}
```

### 18.5 Incomplete session

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess6","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"claude-code"}}
{"type":"user_message","id":"evtf1","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Run the test suite"}}
{"type":"tool_call","id":"evtf2","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"shell_command","args":{"command":"npm test"}}}
{"type":"session_terminated","id":"evtf3","ts":"2026-05-17T14:01:30.000Z","payload":{"reason":"eof_with_open_tool_calls","open_call_ids":["evtf2"]},"source":{"synthesized":true}}
```

### 18.6 MCP call

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess5","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"claude-code"}}
{"type":"user_message","id":"evte1","ts":"2026-05-17T14:00:00.000Z","payload":{"text":"Find my open Linear issues"}}
{"type":"tool_call","id":"evte2","ts":"2026-05-17T14:00:01.000Z","payload":{"tool":"mcp_call","args":{"server":"linear","tool":"list_issues","args":{"status":"open","assignee":"me"},"headers":{"Authorization":"[REDACTED]"}}}}
{"type":"tool_result","id":"evte3","ts":"2026-05-17T14:00:02.000Z","payload":{"for_id":"evte2","ok":true,"output":"[{\"id\":\"ABC-123\",\"title\":\"Fix auth\"}]"}}
```

---

## 19. Open questions for v0.2

- Compression: native gzip support? `.trail.jsonl.gz`?
- Multi-file sessions: how to represent very large sessions split across files.
- Image and binary content: external blob store vs inline base64 vs reference URIs.
- Cryptographic signing for tamper-evident sharing.
- Streaming: explicit header field declaring the stream is incomplete.
- Standardization of common `other` tool args.
- Cost and token tracking: dedicated event type vs payload field?

---

## Changelog

### v0.1.0 (May 2026)

- Initial public draft.
- Defines JSONL file layout, header, core event envelope, five mandatory event types, optional events, tool taxonomy, metadata extensions, tree semantics, validation layers, and artifact-level content addressing.
- Defines stable local source filenames (`spec.md`, `schema.json`) with immutable hosted release snapshots at `/spec/v0.1.0` and `/schema/v0.1.0.json`.

---

## Appendix A — Minimal valid record

```jsonl
{"type":"session","schema_version":"0.1.0","id":"sess1","ts":"2026-05-17T14:00:00.000Z","agent":{"name":"codex-cli"}}
```

A session with only a header is valid. Events are optional.

---

## Appendix B — Reserved type names

The following are reserved for future spec versions. Adapters must not emit them in v0.1.x:

`session_metadata_update`, `attachment_uploaded`, `error`, `system_message`, `permission_request`, `permission_response`, `cost_report`, `signature`.

---

## Appendix C — Design rationale

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
- **Vendor `metadata` with reverse-domain keys:** lets implementations extend without collisions, without growing the canonical vocabulary, and without requiring a central registry.

---

## Appendix D — FAQ

**Why JSONL instead of one big JSON object?**

Streamability and tooling. You can `tail -f` a trail file as it's being written. You can `grep`, `head`, `jq -s`, and pipe it. A single JSON object would require buffering the whole session for any operation and would lose append-friendliness.

**How should I store trail files?**

The spec is unopinionated. Local files, gist, git notes, S3, a database — anything. Sharing tools may have conventions, but the format itself doesn't.

**What if I encounter an agent I don't have an adapter for?**

Either write one (see §13 for the registry; use a reverse-domain `x-<domain>-<name>` for unregistered agents) or use a generic export tool that emits the source agent's events under the `other` tool kind with `source.raw` preserving the original data.

**What about live or streaming sessions?**

A v0.1.x file may be appended to in real time. Omit `content_hash` (or leave as `"<pending>"`) for in-progress files. Readers tolerating no `content_hash` will work fine. A formal "is this complete?" marker is deferred to v0.2.

**How big is too big for a single file?**

The spec doesn't impose limits. Practical guidance: keep individual files under ~100 MB for tooling-friendliness. For very large sessions, multi-file sharding is deferred to v0.2.

**Can I extend the format with custom data?**

Yes, three ways depending on the data:

1. **Verbatim source preservation:** put it in `source.raw`.
2. **Vendor extension with semantics:** put it in `metadata` with a reverse-domain key (`com.example.field`).
3. **Source-agent-specific tools:** use `tool: "other"` with `args: { name, args }`.

Don't invent new top-level event types in v0.1.x.

**How do I handle agent updates that change the source format?**

Pin your adapter to a specific source-agent version in tests. When the source format changes, update the adapter and document the verification in your parser source matrix. Adapters that ignore source schema drift will silently produce wrong output.

**Why isn't redaction part of the spec?**

Redaction policy varies by context (unlisted gist vs public dataset vs HF upload). Building it into the raw format would couple data shape to threat model. Share tooling owns redaction by producing a separate redacted artifact with its own `content_hash`.

**What is the relationship to Agent Trace, OpenSession, HAIL, etc.?**

Agent Trail is a session content format. [Agent Trace](https://agent-trace.dev) is a code attribution format. These are at different layers and can interoperate (an Agent Trace `conversation.url` can point to a trail file). OpenSession (hwisu/opensession) and HAIL JSONL are independent prior art with different design goals — see Appendix E.

---

## Appendix E — Acknowledgements

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
