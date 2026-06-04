# Adapter Authoring Guide

Use this guide when adding or substantially updating an Agent Trail source-agent adapter. It captures the checklist and lessons from the OpenCode adapter work: source-format survey first, source schema before mapping, committed fixtures plus opt-in real smoke tests, and no hidden assumptions about local storage.

## Done Definition

A new adapter is implementation-ready when it has all of these:

- Public adapter export from `@agent-trail/adapters`.
- CLI discovery registration so `trail discover --agent <name>` works.
- Source schema package entries under `@agent-trail/source-schemas`.
- Reader/discovery support for every verified upstream storage surface.
- Header, trail envelope, session-level `content_hash`, and envelope-level `content_hash`.
- Mapping tests for source records to writer-strict Agent Trail records.
- Drift tests that quarantine unknown source records losslessly.
- Optional real-session smoke test that validates broad invariants without requiring rare transcript features.
- At least one committed synthetic fixture or redacted real fixture that locks representative behavior.
- Parser source matrix row updated with status, verified version, observed entry types, and fixture names.
- Verification commands run and recorded in the PR.

Do not edit `schema.json` unless an implementation test proves no existing Agent Trail event can represent the source behavior. Prefer first-class Agent Trail events when fit is strong. Use stable vendor `system_event.payload.kind` values like `x-<agent>/<event>` when fit is weak.

## 1. Survey Source Format First

Before code, gather source truth from both upstream code and real local data.

Check:

- Default storage roots and environment overrides.
- File layouts, filenames, record ids, timestamp units, and project/cwd fields.
- Database files, table names, columns, JSON columns, and foreign keys.
- Whether file storage and database storage are equivalent, complementary, or divergent.
- Upstream version field and whether it is record-level, session-level, database-level, or absent.
- All known top-level record types, content part types, tool names, event names, and terminal states.
- Tool call/result pairing ids and failure/abort states.
- Token/cost/model/provider fields, and whether they are per-message or session totals.
- VCS/worktree/cwd/project metadata.
- Permission, settings, summaries, compaction, and archive/revert state.

OpenCode lesson: file storage and SQLite did not produce identical raw surfaces. File storage had session/message/part/todo trees; SQLite had extra session/project metadata and permission rows. The adapter needed storage-agnostic normalization, file-first precedence for duplicate sessions, and DB enrichment for file sessions where useful metadata existed.

Questions to answer in the implementation ticket:

- What source-agent version was verified?
- Which storage surfaces are supported now?
- Which surfaces are unsupported, and why?
- If two surfaces contain the same session id, which wins?
- Can one surface enrich another without changing event order?
- What is the source schema version key and how is it selected?
- What source drift becomes quarantine rather than a thrown parse failure?

## 2. Add Source Schemas

Source schemas describe upstream records after adapter-local normalization, not Agent Trail records. Trail output still validates against root `schema.json`.

Files to add or update:

- `packages/source-schemas/<agent>/meta.json`
- `packages/source-schemas/<agent>/<version>.json`
- `packages/source-schemas/package.json` exports
- `packages/adapter-kit/src/source-schemas/registry.ts`
- `packages/adapter-kit/src/source-schemas/select.ts`
- Generated `packages/source-schemas/<agent>/<version>.d.ts`

Run:

```bash
bun run generate:source-types
bun run check:source-types
```

Policy:

- Use JSON Schema 2020-12.
- Set `$id` to `https://agent-trail.dev/source/<agent>/<version>.json`.
- Keep schemas strict enough to detect top-level and record/part type drift.
- Keep additive nested fields lenient when upstream commonly adds metadata.
- Add tests that every upstream-known record or part type validates.
- Add tests that unknown top-level or part types quarantine losslessly.

Versioning:

- Use exact upstream session versions when the source has stable schema versions, like Codex.
- Use adapter source schema keys like `v1` when upstream has semver releases but no record schema version, like OpenCode.
- Preserve upstream version on `header.agent.version` and `header.source.format_version` when present. Do not confuse this with source schema key `source.schema_version`.

## 3. Build Reader And Discovery

Every adapter implements `TrailAdapter` from `packages/adapters/src/index.ts`:

- `name`
- `detectSessions(opts?: DetectOptions)`
- `parseSession(ref: SessionRef)`
- `isAvailable()`
- `sourceVersion()`
- `sourceHealth()`

Discovery rules:

- Default discovery filters by current cwd unless `--all` or `allCwds` is set.
- `SessionRef.id` should be the source session id when available.
- `SessionRef.path` should identify the parseable source. For virtual DB refs, use a stable shape like `<db-path>#<session-id>`.
- `modifiedAt` must be ISO.
- `headerStatus` should flag filename fallback when header is unreadable and adapter can tell.
- `sourceHealth()` should report path, readability, session count, source version when knowable, and warnings.

Reader rules:

- Normalize all storage surfaces into one raw-record shape before mapping.
- Keep storage-specific file/DB reading local to the adapter.
- Keep mapping and reconciliation storage-agnostic.
- Use `bun:sqlite` for SQLite in Bun-only adapter/CLI packages. Do not add another SQLite dependency.
- Treat malformed individual files/rows as local drift; quarantine where possible, skip only when there is no usable session identity.
- Prefer deterministic ordering: source timestamps first, then source ids or file paths.

OpenCode pattern:

- File sessions came from `storage/session/<project>/<ses>.json`.
- Messages came from `storage/message/<session>/<msg>.json`.
- Parts came from `storage/part/<message>/<part>.json`.
- Todos came from `storage/todo/<session>.json`.
- DB sessions used `opencode.db#<session-id>` virtual paths.
- Same session in file storage and SQLite yielded the file-storage ref only, with DB metadata enrichment where safe.

## 4. Map To Agent Trail

Start from public behavior tests, one slice at a time. Map only facts present in source; do not fabricate results, token usage, cwd, VCS, or tool outputs.

Core mapping expectations:

- Emit `user_message` and `agent_message` for transcript text.
- Emit `agent_thinking` for reasoning. If only encrypted reasoning exists, emit a clear placeholder like `[encrypted reasoning]`; do not store opaque encrypted blobs in committed fixtures.
- Emit `context_compact` for compaction summaries when semantics match.
- Emit `tool_call` for observed tool invocations.
- Emit `tool_result` only when there is result evidence.
- Emit `tool_call_aborted` or `session_terminated` for open/running/aborted calls when source indicates no result will arrive.
- Emit `task_plan_update` for todo-plan writes when source has structured todos.
- Emit `model_change`, `capability_change`, `session_metadata_update`, `command_invoke`, or `system_event` when source semantics fit.
- Use vendor `system_event` kinds for weak-fit source surfaces, for example `x-opencode/patch`, `x-opencode/snapshot`, `x-opencode/retry`.

Metadata and source preservation:

- Every emitted entry should have `source.agent`.
- Every emitted entry should preserve redacted `source.raw` unless synthesized.
- Use `source.synthesized: true` when no single source record exists.
- Stamp source schema key on `source.schema_version` when validation ran.
- Preserve adapter raw type in `meta`, for example `meta["dev.opencode.raw_type"]`.
- Use `semantic.call_id` on tool calls/results when source has call ids.
- Use `semantic.tool_kind` where useful for downstream linking/search.
- Run source raw through adapter redaction and size policy before emission.

Tool mapping:

- Map known tools to writer-strict `payload.tool` values and args shapes.
- Keep tool names, call ids, titles, metadata, time, attachments, and raw input/output in structured payload/meta where schema allows.
- Pair completed and error results to the correct call id.
- Do not emit fake `tool_result` records for tools that never completed.
- For unknown tools, emit `tool_call.payload.tool: "other"` with enough args to identify original name and input.
- For MCP/plugin-style names, map to `mcp_call` metadata when source names expose server/tool structure.

File and attachment mapping:

- If source attaches files to user or assistant messages with URL/MIME, emit message `payload.attachments`.
- Do not dereference local files during parse unless the source format itself embeds content.
- Preserve source details in `source.raw`.
- For patches/diffs, prefer `system_event` or `session_metadata_update` when existing Agent Trail events are not exact. Preserve file list, hashes, additions/deletions, and redacted diff metadata when present.

Session metadata:

- Put stable session identity in header.
- Use `session_metadata_update` for useful changes like name/title, share URL, archive/compacting/revert state, model defaults, agent, VCS branch/worktree, and summary metadata.
- Avoid noisy one-event-per-column behavior. Group related metadata when possible and useful.
- Include session totals only when schema has a correct field. Otherwise preserve them in source/raw or vendor metadata events.

## 5. Header, Envelope, Hashes

Adapters should emit:

- A `trail` envelope by default via `buildTrailEnvelope`.
- One `session` header per parsed source session.
- `header.agent.name` equal to adapter name.
- `header.agent.version` from upstream when present.
- `header.source.agent`, `header.source.format`, `header.source.format_version`, and `header.source.path` when known.
- Stable `session_uid` derived from source id and adapter namespace.
- Header `cwd` from source if available.
- Header VCS from source session data first; use live git discovery only when adapter policy says so.
- Envelope name derived from session title/name when useful.
- Session-level `content_hash` stamped before envelope-level `content_hash`.

Use `stampTrail` after assembling full trail. If redaction mutates records after stamping, restamp.

## 6. Register Public Surfaces

Adapter package:

- Add `packages/adapters/src/<agent>/index.ts`.
- Add path helpers under `packages/adapters/src/<agent>/paths.ts` when storage roots or env vars are non-trivial.
- Export from `packages/adapters/src/index.ts`.
- Update `packages/adapters/README.md`.

CLI:

- Import adapter in `packages/cli/src/discover.ts`.
- Add it to `DEFAULT_ADAPTERS`.
- Add CLI tests for `--agent`, `--all`, current cwd, explicit `--cwd`, `--json`, `--since`, and `--until`.
- If adapter has multiple storage surfaces, seed each in tests. For DB refs, assert virtual path behavior.

Docs:

- Update `docs/parser-source-matrix.md`.
- Add or update adapter-specific smoke command examples.
- Mention DB-only or file-only coverage explicitly.

## 7. Test With Vertical TDD

Use small public-behavior slices. A good sequence:

1. Adapter surface: name, export, availability, `sourceHealth`, `sourceVersion`.
2. File/session discovery for primary storage.
3. DB or secondary storage discovery.
4. Hybrid precedence for duplicate session ids.
5. Header/envelope/hash stamping.
6. Core user/agent messages with model/provider/tokens.
7. Reasoning, compaction, and summaries.
8. Tools: known tools, unknown tools, pairing, errors, abort/running states.
9. Session events: model changes, todos, permissions, settings, generic events.
10. Attachments/files/patches/diffs.
11. Source schema drift and quarantine.
12. CLI discovery filters/output.
13. Real smoke and redacted fixture.

Per slice:

```bash
bun test packages/adapters/src/<agent>
```

Final adapter-local gate:

```bash
bun run check:source-types
bun test packages/adapters/src/<agent>
bun test packages/adapters
bun test packages/cli
bun run typecheck
```

Full PR gate:

```bash
bun run check
```

## 8. Real Smoke Tests

Real-session smoke tests are opt-in and skipped in CI. They should parse one real local session, validate writer-strict output, and assert optional-field correctness when present.

Rules:

- Do not require rare features to exist in the real session.
- Do assert correctness when optional fields are present.
- Print or expose feature counts in failure messages so gaps are easy to diagnose.
- Support an env var for a specific session path.
- Also fall back to default source-agent roots locally when safe.
- For DB-capable adapters, add a separate DB smoke test if DB output can differ from file output.
- Never commit raw local sessions.

Example env var names:

- `AGENT_TRAIL_REAL_<AGENT>_SESSION`
- `AGENT_TRAIL_REAL_<AGENT>_ROOT`
- `AGENT_TRAIL_REAL_<AGENT>_DB_SESSION`

OpenCode used both:

```bash
AGENT_TRAIL_REAL_OPENCODE_ROOT=/abs/path/to/opencode bun test packages/adapters
AGENT_TRAIL_REAL_OPENCODE_DB_SESSION=/abs/path/to/opencode.db#ses_... bun test packages/adapters
```

## 9. Committed Fixtures

Committed fixtures lock behavior without needing contributor-local sessions.

Allowed:

- Synthetic source fixtures.
- Manually redacted real-source fixtures.
- Fixture-building tests for storage-tree or SQLite sources where a single native file is not the source format.

Forbidden:

- Raw transcript text.
- PII.
- Secrets, API keys, bearer tokens, PATs, private keys.
- Contributor-local paths.
- Private repository URLs.
- Machine/user identifiers.
- Opaque encrypted reasoning blobs.

Redacted real fixture process:

1. Pick a real session with broad field coverage, not necessarily the latest or largest.
2. Flatten or materialize storage if native format is multi-file.
3. Redact source fixture and generated trail fixture consistently.
4. Preserve safe ids, enum values, model ids, tool names, and schema field names when non-identifying.
5. Normalize local `source.path` to placeholders like `[REDACTED_PATH]`.
6. Restamp session and envelope content hashes after redaction.
7. Add leak scans for paths, usernames, private remotes, and common secret patterns.
8. Add fixture test that parses redacted source through real adapter code and byte-compares expected trail.

OpenCode fixture lesson: because native file storage is a tree, the committed source fixture is flattened JSONL with `session`, `message`, `part`, and `todo` records. The test materializes that JSONL into a temp OpenCode storage tree, parses through `opencodeAdapter`, normalizes temp paths, restamps hashes, and compares to the golden trail.

## 10. Parser Source Matrix

Update `docs/parser-source-matrix.md` in the same PR.

The row must state:

- Adapter status.
- Source status and storage format.
- Reuse boundary.
- Primary references.
- Verification date.
- Verified source-agent version.
- Observed entry types.
- Fixture names.
- Notes for unsupported or DB-only/file-only surfaces.

Only mark an adapter `verified` when committed fixtures or fixture-building tests lock main behavior.

## 11. PR Checklist

Before opening or updating PR:

- Source survey notes captured in issue or PR.
- Source schema added and generated types committed.
- Adapter exported from `@agent-trail/adapters`.
- CLI discovery registration and tests added.
- `source.raw` redaction/size policy applied.
- Unknown source drift quarantines losslessly.
- Tool calls/results use source call ids and do not fabricate results.
- Header, envelope, VCS, session metadata, and hashes validated.
- File, DB, or hybrid precedence documented and tested.
- Real smoke test exists and is optional.
- Committed fixture exists and contains no local/private data.
- Parser source matrix updated.
- Verification output recorded.

Recommended final commands:

```bash
bun run check:source-types
bun test packages/adapters/src/<agent>
bun test packages/adapters
bun test packages/cli
bun run typecheck
bun run check
```

