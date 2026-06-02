# Session bundles and child sessions

Agent Trail supports one trail file containing one or more **session groups**. A file with multiple groups is a **session bundle**: a forest of session groups. Each group remains an ordinary session and may be linear or tree-native. Pi `/tree` branches, branch summaries, and source `parentId` forks stay inside one Pi group as `parent_id` topology; they are not child sessions.

External subagents and forked transcripts are modeled as **child sessions**. The durable edge lives on the child session header:

```json
{ "fork_from": { "session_id": "<parent-session-id>", "entry_id": "<parent-event-id>" } }
```

`entry_id` is emitted only when the source exposes a clear parent event. `content_hash` is optional best-effort and refers to the parent session-level content hash when known. The parent `subagent_invoke.args.session_id` points to the child header `id` when the adapter can link the child confidently. Source runtime ids that are not durable Agent Trail header ids stay in `meta` or `source.raw`.

**Considered Options**

- Encode all child work as `parent_id` subtrees inside the parent group (rejected: Codex and current Claude Code store full child transcripts as separate session files, and `parent_id` must not cross groups).
- Put the graph in the envelope `sessions` manifest (rejected: duplicates authoritative lineage and makes extraction brittle).
- Make `header.fork_from` authoritative and keep the manifest as an index/rendering hint (chosen).

**Consequences**

- Adapter `TrailFile` uses exact grammar: `envelope? + groups[]`, with no top-level `header` or `entries`.
- The envelope `sessions` manifest is minimal: `{ id, agent }` for each group in file order.
- Whole-file validation warns, not errors, when in-file parent `subagent_invoke` and child `fork_from` links disagree.
- Codex `spawn_agent` and Claude Code `Agent` / `Task` can emit parent `subagent_invoke` plus direct child groups when linked confidently.
- Missing, ambiguous, or external-only child links remain readable: adapters annotate what they know and do not invent child groups.

Closes #107.
