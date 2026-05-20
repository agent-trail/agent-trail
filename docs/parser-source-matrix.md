# Parser Source Matrix

The living record of adapter source formats, verification dates, and fixture coverage. This document is the canonical source of truth for which source agents Agent Trail adapters cover, what was verified, when, and which committed fixtures lock that behavior.

See PRD [§7.2](./PRD.md) for the product specification of this matrix, and [`CONTEXT.md`](../CONTEXT.md) for the glossary entry. Modeled after [hwisu/opensession's parser-source-matrix.md](https://github.com/hwisu/opensession/blob/main/docs/parser-source-matrix.md).

## Status legend

- `pending verification` — adapter not yet implemented, or storage format not yet verified against the listed source-agent version.
- `verified` — adapter implemented, fixtures committed under `tests/fixtures/`, and behavior locked against the listed source-agent version on the listed verification date.
- `deprecated` — adapter or source format no longer covered. See notes for migration guidance.

An adapter is only considered supported once its row is `verified` with at least one committed synthetic fixture.

## Matrix

| Source agent | Source status | Storage format(s) | Reuse boundary | Reference URL | Verified on | Source-agent version | Observed entry types | Fixture names | Status |
|---|---|---|---|---|---|---|---|---|---|
| Pi | — | — | — | — | — | — | — | — | pending verification |
| Claude Code | closed | JSONL at `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl` | re-implement | https://docs.anthropic.com/claude-code | 2026-05-20 | 1.0.0-synthetic | user_message, agent_message, tool_call, tool_result, session_summary | claude-code/basic-flow.jsonl | verified |
| Codex CLI | open | — | re-implement | — | — | — | — | — | pending verification |
| Cursor | closed | — | re-implement | — | — | — | — | — | pending verification |
| Gemini CLI | open | — | re-implement | — | — | — | — | — | pending verification |
| Aider | open | — | re-implement | — | — | — | — | — | pending verification |

Columns map directly to PRD §7.2. Cells use `—` when not yet determined. Source status (`open` / `closed`) reflects whether the source agent's session writer code is publicly available; it does not imply licensing of the trail format itself.

## Fixture policy

Agent Trail adapter work distinguishes two kinds of fixtures:

1. **Committed fixtures** must be synthetic or redacted. They live under `tests/fixtures/` and are reviewed in PRs. No real session content, no PII, no secrets, no API keys, no real user identifiers, no real file paths from contributors' machines. See [`tests/fixtures/validation/README.md`](../tests/fixtures/validation/README.md) for the canonical example: synthetic ids, synthetic agent names, synthetic timestamps, one scenario per file, documented expected diagnostics.

2. **Real local sessions** stay out of git. Adapters may include opt-in ignored tests that load a path from an environment variable (e.g. `AGENT_TRAIL_REAL_CLAUDE_CODE_DIR`) and skip when unset. These tests run on the contributor's machine, never in CI, and never check fixture data into the repo.

An adapter PR is not eligible to move its matrix row from `pending verification` to `verified` until:

- At least one committed synthetic fixture exercises the adapter's main entry types.
- The verification date and source-agent version are filled in.
- Observed entry types and fixture names columns reflect the committed fixtures.

If real-session debugging produces a fixture worth committing, redact it (strip PII, replace ids with synthetic ones, normalize timestamps) and add it under `tests/fixtures/`. The redacted fixture, not the raw session, is what locks behavior.

## Update procedure

When an adapter author verifies behavior against a new source-agent version:

1. Run the adapter's fixture tests against the new source-agent release.
2. Update the row's `Verified on`, `Source-agent version`, `Observed entry types`, and `Fixture names` columns.
3. If new entry types appeared, add a fixture under `tests/fixtures/` covering each, and reference it in the matrix.
4. If existing entry types changed shape, treat as a breaking source-format change: note it in the row, add a fixture for the new shape, keep the prior fixture if older versions remain supported.
5. Flip status to `verified` once all of the above are in the PR.

A row going stale (no re-verification against a current source-agent release) does not automatically downgrade, but adapter authors should re-verify on a cadence proportional to the source agent's release velocity.
