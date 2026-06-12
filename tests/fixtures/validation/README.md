# Validation fixtures

Committed synthetic trail files exercising the Agent Trail validation paths. All fixtures are reusable across `@agent-trail/core`, `@agent-trail/cli`, and future adapter tests.

Fixture policy for the workspace lives in [`docs/parser-source-matrix.md`](../../../docs/parser-source-matrix.md#fixture-policy): committed fixtures are synthetic or redacted; real local sessions stay out of git and are loaded only by opt-in ignored tests.

## Conventions

- File extension: `.trail.jsonl` (spec.md §5.1).
- Synthetic data only. No real session content, no PII, no secrets.
- Synthetic ids are deterministic spec-shaped values such as `01HSESS...` and `01HEVTA...`; synthetic agent: `codex-cli`; synthetic timestamps anchored at `2026-05-17T14:00:00.000Z`.
- One scenario per file. Filename is the scenario in kebab-case.
- Scenarios are grouped by validation layer (`valid/`, `invalid-schema/`, `invalid-graph/`, `hash-mismatch/`, `reader-tolerant/`).
- Expected diagnostics are documented below. Tests in `packages/core/src/fixtures.test.ts` and `packages/cli/src/validate.test.ts` assert them.

## Loading

```ts
const FIXTURES = new URL("../../../tests/fixtures/validation/", import.meta.url);
const loadFixture = (rel: string) => Bun.file(new URL(rel, FIXTURES)).text();
```

For CLI tests that need a real on-disk path:

```ts
import { fileURLToPath } from "node:url";
const path = fileURLToPath(new URL("valid/minimal-linear.trail.jsonl", FIXTURES));
```

<!-- conformance-manifest:start -->
## Scenarios

This section is generated from `manifest.json`; run `bun run sync:conformance` after fixture or expectation changes.

### hash-mismatch/

- `hash-mismatch/content-hash-invalid-hex.trail.jsonl` — classes: W, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `hash-mismatch/content-hash-mismatch.trail.jsonl` — classes: W, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `hash-mismatch/trail-envelope-content-hash-mismatch.trail.jsonl` — classes: W, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)

### hash-vectors/

- `hash-vectors/absent-content-hash.trail.jsonl` — classes: W, R2, strict: valid, tolerant: clean
- `hash-vectors/envelope-two-tier.trail.jsonl` — classes: W, R2, strict: valid, tolerant: clean
- `hash-vectors/jcs-stress.trail.jsonl` — classes: W, R2, strict: valid, tolerant: clean
- `hash-vectors/minimal-pending-roundtrip.trail.jsonl` — classes: W, R2, strict: valid, tolerant: clean
- `hash-vectors/multi-session-slice.trail.jsonl` — classes: W, R2, strict: valid, tolerant: clean
- `hash-vectors/replacement-char.trail.jsonl` — classes: W, R2, strict: valid, tolerant: clean
- `hash-vectors/segment-chain-seq1.trail.jsonl` — classes: W, R2, strict: valid, tolerant: clean
- `hash-vectors/segment-chain-seq2.trail.jsonl` — classes: W, R2, strict: valid, tolerant: clean

### invalid-graph/

- `invalid-graph/ambiguous-sequential-pairing-with-session-end.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/ambiguous-sequential-pairing.trail.jsonl` — classes: W, R1, R2, strict: valid with 2 diagnostic(s), tolerant: 2 diagnostic(s)
- `invalid-graph/branch-point-unknown-from-id.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/branch-summary-unknown-abandoned-branch-id.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/duplicate-id.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-graph/duplicate-option-labels-mixed-ids.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/duplicate-option-labels.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/duplicate-segment-seq.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/duplicate-tool-result-for-id.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/envelope-not-at-line-1.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-graph/envelope-sessions-manifest-empty.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/envelope-sessions-manifest-multiple.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/envelope-without-session-header.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-graph/header-has-parent-id.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-graph/multi-session-cross-group-parent.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-graph/multi-session-orphan-prelude.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-graph/multiple-envelopes.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-graph/non-interoperable-number.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/non-monotonic-event-ts.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/out-of-order-segment-seq.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/parent-cycle.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-graph/parse-fidelity-drift.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-graph/sequential-pairing-stays-in-branch.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/sequential-pairing-stays-in-sibling-branch.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/sequential-pairing-stays-in-subagent-sibling-branch.trail.jsonl` — classes: W, R1, R2, strict: invalid with 3 assertion(s), tolerant: 4 diagnostic(s)
- `invalid-graph/session-end-forward-final-message-id.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/session-end-unknown-final-message-id.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/stream-open-with-content-hash.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-graph/tool-args-unredacted-secret.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/tool-call-aborted-turn-scope-does-not-close-call.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/tool-result-for-id-wins-over-semantic-conflict.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/unknown-parent-id.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-graph/unmatched-tool-call-at-eof.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/unmatched-tool-call-partial-suppression.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/unmatched-tool-call-session-terminated-without-open-call-ids.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)
- `invalid-graph/user-query-response-unknown-for-id.trail.jsonl` — classes: W, R1, R2, strict: valid with 1 diagnostic(s), tolerant: 1 diagnostic(s)

### invalid-schema/

- `invalid-schema/agent-message-attachment-bad-uri.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/agent-message-usage-extra-field.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/agent-message-usage-missing-output.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/agent-message-usage-missing-required.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/agent-message-usage-zero-context-window.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/agent-thinking-usage-missing-output.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/capability-change-bad-reason.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/capability-change-bad-scope.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/capability-change-empty.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/command-invoke-bad-kind.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/command-invoke-bad-result-action.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/command-invoke-missing-kind.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/command-invoke-missing-name.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/envelope-missing-producer.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/header-wrong-schema-version.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-schema/redaction-count-non-integer.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/segment-seq-1-with-prev-hash.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/segment-seq-2-without-prev-hash.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/segment-seq-2-without-session-uid.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/segment-seq-zero.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/session-end-final-message-id-null.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/session-metadata-update-bad-field-cwd.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/session-metadata-update-bad-reason.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/session-metadata-update-bad-tags-value.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/session-metadata-update-bad-worktree.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/session-uid-not-ulid-or-uuid.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/tool-call-aborted-bad-reason.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/tool-call-aborted-tool-scope-missing-for-id.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/tool-call-aborted-turn-scope-with-for-id.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/tool-call-file-list-missing-path.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-schema/tool-call-file-patch-empty-files.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-schema/tool-call-file-patch-file-missing-diff.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-schema/tool-call-missing-args-path.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-schema/tool-call-usage-missing-output.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/tool-result-attachment-extra-field.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 2 diagnostic(s)
- `invalid-schema/tool-result-meta-file-read-range-wrong-length.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/tool-result-meta-mcp-call-block-missing-type.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/tool-result-meta-shell-command-extra-field.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/tool-result-truncated-missing-output-size.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/user-message-missing-text.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/user-message-non-string-text.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/vcs-null-revision-with-empty-branch.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/vcs-null-revision-with-head-commit.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `invalid-schema/vcs-null-revision-without-branch.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)

### reader-tolerant/

- `reader-tolerant/capability-change-unknown-payload-field.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `reader-tolerant/ill-formed-string.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `reader-tolerant/nested-unknown-payload-field.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `reader-tolerant/patch-compatible-schema-version.trail.jsonl` — classes: W, R1, R2, strict: invalid with 2 assertion(s), tolerant: 1 diagnostic(s)
- `reader-tolerant/reserved-future-event-type.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `reader-tolerant/tool-result-meta-registered-extra-field.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `reader-tolerant/unknown-event-type.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)
- `reader-tolerant/unknown-payload-field.trail.jsonl` — classes: W, R1, R2, strict: invalid with 1 assertion(s), tolerant: 1 diagnostic(s)

### valid/

- `valid/agent-message-attachments-multiple.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/agent-message-attachments.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/agent-message-usage.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/agent-thinking-usage.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/capability-change-initial-snapshot.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/capability-change.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/command-invoke-extension-kind.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/command-invoke-full.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/command-invoke-minimal.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/command-invoke-plugin.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/command-invoke-result-action-ext.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/command-invoke-slash.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/context-compact-provenance-only-ids.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/context-compact-replaced-message-ids.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/linear-with-parent-ids.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/minimal-linear.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/minimal-with-content-hash.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/multi-segment-seg1.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/multi-segment-seg2.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/multi-session-fork-from-chain.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/multi-session-two-no-envelope.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/multi-session-with-envelope.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/multiple-session-end-events.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/redaction-count-meta.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/session-end-final-message-id-references-header.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/session-end-with-final-message-id.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/session-header-metadata-base.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/session-metadata-update-agent-model-default.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/session-metadata-update-name.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/session-metadata-update-tags.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/session-metadata-update-vcs-branch.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/session-metadata-update-vendor.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/spec-example-incomplete-session.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/spec-example-mcp-call.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/spec-example-synthesized-event.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/spec-example-tool-call-semantic-pairing.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/spec-example-tool-result-fallback-pairing.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/spec-example-tree-abandoned-branch.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/streaming-finalized-clean.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/streaming-open.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/system-event-vcs-commit.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-aborted-closes-call.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-aborted-extension-scope-reason.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-aborted-turn-scope.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-file-list.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-file-patch.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-matched-by-for-id.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-matched-by-semantic-call-id.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-matched-same-parent-siblings.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-matched-sequentially.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-call-usage.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-attachments-with-mcp-meta.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-attachments.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-for-id-targets-header-falls-through.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-meta-file-read.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-meta-mcp-call.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-meta-shell-command.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-meta-toplevel-vendor-kind.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-meta-unregistered-kind.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-meta-vendor-extension.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/tool-result-output-size-truncated.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/unmatched-tool-call-suppressed-by-session-end.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/unmatched-tool-call-suppressed-by-session-terminated.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/user-message-origin-injected.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/user-query-duplicate-labels-with-ids.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/vcs-unborn-head.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/with-trail-envelope-all-fields.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/with-trail-envelope-and-hash.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean
- `valid/with-trail-envelope.trail.jsonl` — classes: W, R1, R2, strict: valid, tolerant: clean

<!-- conformance-manifest:end -->
