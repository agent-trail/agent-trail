# Core Packages And CLI Refactor RFC

Status: draft
Date: 2026-06-04

## Summary

This RFC ranks large, behavior-preserving simplification refactors for the core
Agent Trail packages: `@agent-trail/core`, `@agent-trail/cli`,
`@agent-trail/store`, and `@agent-trail/redact`.

The project is unreleased, so public/internal APIs may change when they remove
real complexity. The default policy remains strict: do not change `schema.json`,
Trail record semantics, hash semantics, reconciliation semantics, redaction
meaning, or CLI command behavior unless the PR explicitly says so and proves it
with tests.

The refactor should run in large chunks and trust the strengthened test suite.
Prefer PRs that deepen modules around real domain responsibilities instead of
small cosmetic shuffles.

## Baseline

Commands run after syncing this worktree to `main`:

- `bun run worktree:doctor`: passed; warned that PR status could not be found
  for two local branches and stale origin refs could not be checked.
- `bun run check`: passed.

Package size by `packages/*/src`:

| Package | Files | Lines | Avg lines/file |
|---|---:|---:|---:|
| `core` | 29 | 9397 | 324 |
| `cli` | 24 | 5005 | 209 |
| `redact` | 9 | 2790 | 310 |
| `store` | 6 | 639 | 107 |
| `adapter-kit` | 52 | 3091 | 59 |

Largest relevant files:

| File | Lines | Note |
|---|---:|---|
| `packages/core/src/validation.test.ts` | 1916 | Broad validation behavior coverage. |
| `packages/redact/src/redactor.test.ts` | 1539 | Redaction traversal and mutation coverage. |
| `packages/core/src/fixtures.test.ts` | 1329 | Fixture/schema contract coverage. |
| `packages/core/src/graph.test.ts` | 930 | Whole-file graph validation coverage. |
| `packages/redact/src/redactor.ts` | 776 | Traversal, rule matching, and mutation in one module. |
| `packages/core/src/graph-checks.ts` | 742 | Cross-record validation checks in one module. |
| `packages/core/src/reconcile.test.ts` | 736 | Reconciler contract coverage. |
| `packages/cli/src/load.test.ts` | 536 | CLI load pipeline coverage. |
| `packages/cli/src/share.test.ts` | 481 | CLI share/redaction coverage. |
| `packages/cli/src/discover.test.ts` | 471 | Adapter discovery command coverage. |

Guardrails read before ranking:

- `CONTEXT.md`: use Trail file, Session group, Session bundle, Adapter, Local
  store, Finalized object, Session UID, Raw/Redacted/Shared trail precisely.
- `spec.md`: spec scope ends at the trail file; hashes identify exact bytes;
  `parent_id` is tree topology only.
- ADR-0004: trail envelope and session/file content hashes are separate
  identities.
- ADR-0006: multi-segment reconciler and id tightening are load-bearing.
- ADR-0007: child sessions are separate Session groups linked by `fork_from`.
- `docs/PRD.md`: V1 sharing uses gist-locating viewer URLs; hosted resolver
  semantics are deferred.

## Ranking

| Rank | Candidate | Strength | Main payoff | Main risk |
|---:|---|---|---|---|
| 1 | Introduce Commander.js CLI runtime | Strong | One command surface before bigger CLI/TUI work | Help/error output churn |
| 2 | Deepen validation graph modules | Strong | Smaller core validation files with clearer invariants | Error ordering/message drift |
| 3 | Collapse reconciler internals behind one interface | Strong | Safer multi-segment changes and store usage | Accidentally weakening id semantics |
| 4 | Deepen shared CLI/store trail pipeline | Worth exploring | Less load/export/share duplication | Hiding command-specific behavior |
| 5 | Split redaction traversal from mutation | Worth exploring | More testable redaction internals | Redaction output drift |

## 1. Introduce Commander.js CLI Runtime

Recommendation: Strong.

Current friction:

- `validate`, `discover`, `list`, `share`, `load`, and `export` repeat command
  mechanics: `parseArgs` wrappers, usage errors, positional argument checks,
  option coercion, and `{ exitCode, stdout, stderr }` result handling.
- `bin.ts` owns dispatch and terminal writes directly, while command modules own
  partial usage formatting.
- `load` and `export` both preflight output paths; `export` also owns id/hash
  validation and prefix lookup mechanics that should be easier to isolate.
- Future `trail view` or `trail tui` can use OpenTUI inside a command action, but
  OpenTUI does not replace argv parsing or command dispatch.

Proposed shape:

- Add Commander.js as the CLI parser dependency for `@agent-trail/cli`.
- Create a small command runtime module that builds one `Command` tree and
  registers existing commands through typed adapters.
- Keep command business logic returning the current style of result for
  non-interactive commands: `exitCode`, `stdout`, `stderr`.
- Let future interactive commands, such as an OpenTUI viewer, own terminal
  rendering inside the command action and return only after cleanup.
- Centralize output writes in `bin.ts` or one runtime function. Command modules
  should not call `process.exit`, write to global streams, or parse raw argv
  directly.
- Preserve current command names, options, defaults, stdout JSON shape, and exit
  codes unless a PR explicitly opts into a CLI behavior change.

Migration steps:

1. Add Commander.js and a runtime smoke test around `trail --help`, unknown
   commands, known command dispatch, and exit code propagation.
2. Move `bin.ts` dispatch into the runtime without changing command business
   modules yet.
3. Convert `validate`, `discover`, and `list` first because they cover the main
   parse/result patterns with lower filesystem risk.
4. Convert `load`, `export`, and `share` after adding focused tests around output
   path preflight, id/hash lookup, and redaction option behavior.
5. Delete local `parseArgs`/usage helpers once no command imports them.
6. Add one placeholder design note in docs or tests that an OpenTUI viewer should
   be a normal Commander subcommand, not a separate parser stack.

Expected result:

- `bin.ts` becomes thin executable glue.
- Command modules keep domain behavior but stop owning parser mechanics.
- CLI structure is ready for a future OpenTUI viewer without forcing the TUI PR
  to reorganize command dispatch.

Verification:

- `bun test packages/cli/src`
- `bun run check`
- Compare representative current stdout/stderr snapshots for success and failure
  cases before/after conversion.

## 2. Deepen Validation Graph Modules

Recommendation: Strong.

Current friction:

- `graph-checks.ts` and validation tests cover multiple responsibilities at once:
  record id rules, parent topology, tool call/result relationships, summary
  references, bundle/fork rules, attachment references, and hash checks.
- The behavior is well covered, but the implementation is hard to navigate for
  future spec tightening.

Proposed shape:

- Keep the public validation entrypoints stable.
- Split whole-file validation into domain modules:
  - topology and parent constraints
  - tool call/result linking
  - summary and compact provenance
  - bundle/fork relationships
  - attachment/artifact references
  - envelope/hash verification
- Keep one coordinator that preserves current check order and error collection
  semantics.
- Move tests only after production behavior has parity coverage; avoid a giant
  test rewrite in the same step as logic movement.

Migration steps:

1. Add order-lock tests for representative validation errors if current tests do
   not already pin message/order where users observe them.
2. Extract pure check families one at a time while the coordinator keeps the same
   public output.
3. Split tests by behavior family after the production split is stable.
4. Remove duplicated fixture setup only after split tests are readable.

Expected result:

- Smaller validation modules named after Trail invariants.
- Easier future changes to schema-adjacent behavior without touching unrelated
  checks.
- No schema or validation semantics change.

Verification:

- `bun test packages/core/src/graph.test.ts`
- `bun test packages/core/src/validation.test.ts`
- `bun run check`

## 3. Collapse Reconciler Internals Behind One Interface

Recommendation: Strong.

Current friction:

- Reconciliation is load-bearing for multi-segment sessions and store ingestion.
- Current tests are strong enough to permit larger movement, but future callers
  should not depend on incidental helper shapes.

Proposed shape:

- Keep one public reconciler interface for incoming Trail segments.
- Hide internal phases behind local modules:
  - segment identity and session uid checks
  - base/head selection
  - id remapping and conflict checks
  - final record ordering
  - diagnostics/result construction
- Make `@agent-trail/store` consume only the public reconciler interface, not
  lower-level helpers.

Migration steps:

1. Pin current reconciler result shapes with focused tests around replacement,
   conflict, duplicate, and child-session cases.
2. Move internal phases under a reconciler directory or private modules.
3. Update store ingestion to use the public interface only.
4. Delete exports that only existed for internal tests; test through public
   behavior unless a pure helper has real standalone value.

Expected result:

- Reconciler complexity remains in `core`, but callers see one stable ingestion
  contract.
- Store package has less knowledge of segment internals.
- No change to Session UID, segment replacement, or child-session semantics.

Verification:

- `bun test packages/core/src/reconcile.test.ts`
- `bun test packages/store/src`
- `bun run check`

## 4. Deepen Shared CLI/Store Trail Pipeline

Recommendation: Worth exploring.

Current friction:

- `load`, `export`, and `share` each touch local store lookup, trail parsing,
  final object identity, output path checks, and command-specific rendering.
- Some duplication is real, but over-extracting could hide command semantics that
  should stay explicit.

Proposed shape:

- Extract only behavior shared by at least two commands with identical semantics:
  output path preflight, store id/hash prefix resolution, finalized object lookup,
  and Trail file loading.
- Keep redaction, gist/share behavior, and export format behavior command-local.
- Use the Commander runtime from candidate 1 before this refactor, so shared
  pipeline code does not also absorb parser concerns.

Migration steps:

1. Identify repeated CLI/store code after Commander conversion.
2. Add focused unit tests for each extracted pipeline primitive.
3. Convert `load` and `export` first; convert `share` only where semantics are
   truly identical.
4. Keep command-level integration tests as the acceptance source.

Expected result:

- Less duplicated path/id/store plumbing.
- Command files read as command behavior rather than IO choreography.
- No change to local store layout or shared trail transport shape.

Verification:

- `bun test packages/cli/src/load.test.ts`
- `bun test packages/cli/src/export.test.ts`
- `bun test packages/cli/src/share.test.ts`
- `bun test packages/store/src`
- `bun run check`

## 5. Split Redaction Traversal From Mutation

Recommendation: Worth exploring.

Current friction:

- `redactor.ts` mixes traversal, rule matching, replacement/mutation, redaction
  metadata, and policy defaults.
- `redactor.test.ts` is large because many behavior paths must be verified through
  the full public redaction call.

Proposed shape:

- Keep public redaction APIs stable unless a later PR explicitly improves them.
- Split internals into:
  - traversal over Trail records and nested fields
  - rule matching/classification
  - replacement/mutation
  - report/metadata construction
- Prefer pure functions for rule matching and traversal decisions; keep mutation
  at the edge.

Migration steps:

1. Add targeted tests for traversal decisions and report output before moving
   logic.
2. Extract traversal without changing replacement behavior.
3. Extract matching/classification after traversal is stable.
4. Split test file by behavior family only after production movement is complete.

Expected result:

- Redaction internals become easier to test without broad fixture setup.
- Future policy changes can touch rule matching without risking traversal.
- Redacted Trail output remains byte-stable for committed fixtures unless a PR
  explicitly changes policy.

Verification:

- `bun test packages/redact/src`
- `bun test packages/cli/src/share.test.ts`
- `bun run check`

## PR Sequence

1. `refactor(cli): adopt commander runtime`
   - Adds Commander.js, central command runtime, and converts all current CLI
     commands.
   - Establishes future OpenTUI viewer command shape.
2. `refactor(core): split validation graph checks`
   - Moves validation check families behind one coordinator.
3. `refactor(core-store): tighten reconciler boundary`
   - Hides reconciler internals and updates store ingestion.
4. `refactor(cli-store): extract shared trail pipeline`
   - Removes repeated load/export/share plumbing after CLI parser migration.
5. `refactor(redact): split traversal from mutation`
   - Deepens redaction internals and splits tests after parity is proven.

## API / Interface Policy

- Commander.js becomes an implementation dependency of `@agent-trail/cli`, not a
  library-package dependency.
- CLI stdout/stderr/exit behavior is treated as compatibility-sensitive even
  though the project is unreleased.
- Public API changes in `core`, `store`, or `redact` are allowed only when they
  remove real coupling and are documented in the PR.
- Schema, hash, reconciliation, and redaction semantic changes require explicit
  spec/ADR rationale. Default is behavior-preserving refactor.
- New shared interfaces must be earned by at least two callers using identical
  semantics.

## Test Plan

- Run `bun run check` before and after each PR.
- Add focused parity tests before moving code in each candidate.
- For CLI migration, pin representative stdout/stderr/exit behavior for both
  success and failure paths.
- For validation and reconciliation, preserve error ordering and result shapes
  unless a PR explicitly changes them.
- For redaction, assert redacted Trail output and redaction reports remain stable
  for committed fixtures.

## Assumptions

- Refactor PRs can be large because current test coverage is trusted.
- Commander.js is preferred over a no-library CLI runtime.
- OpenTUI, when added later, should live behind a normal CLI subcommand action and
  should not force another parser migration.
- Adapter refactors remain separate follow-up work after this core/CLI RFC.
